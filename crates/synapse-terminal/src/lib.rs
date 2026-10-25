//! Composition and the plain-text terminal boundary.
mod args;
mod input;
mod output;
mod review_ui;
mod strings;
use args::{Invocation, ProviderChoice, WorkspaceArgs};
use std::{
    ffi::OsString,
    io::{self, IsTerminal, Write},
    process::ExitCode,
    sync::Arc,
};
use synapse_adapters::{CanonicalWorkspace, DiskStateStore, PollingWatcher};
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, ContentHash, ModelJob, ModelService, Priority,
    PublicError, StateStore, WorkspaceReadPort,
};

pub fn sanitize(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() && !matches!(*c,'\u{061c}'|'\u{200b}'..='\u{200f}'|'\u{2028}'..='\u{202e}'|'\u{2060}'..='\u{206f}'|'\u{feff}')).collect()
}
fn model(
    choice: ProviderChoice,
    reader: Arc<CanonicalWorkspace>,
    policy: AccessPolicy,
) -> Result<Box<dyn ModelService>, PublicError> {
    Ok(match choice {
        ProviderChoice::Local => Box::new(synapse_adapters::workspace_local_queue(reader, policy)),
        ProviderChoice::OpenRouter { model, consent } => Box::new(
            synapse_adapters::workspace_openrouter_queue(model, consent, reader, policy)?,
        ),
    })
}
fn provider_fingerprint(choice: &ProviderChoice) -> ContentHash {
    match choice {
        ProviderChoice::Local => {
            ContentHash::of(b"bonsai:127.0.0.1:18080:4096:1:thinking-disabled")
        }
        ProviderChoice::OpenRouter { model, consent } => ContentHash::combined(&[
            b"openrouter",
            model.as_bytes(),
            if *consent { b"consented" } else { b"denied" },
        ]),
    }
}
fn open(
    workspace: &WorkspaceArgs,
    cancel: &Cancellation,
) -> Result<Arc<CanonicalWorkspace>, PublicError> {
    Ok(Arc::new(
        CanonicalWorkspace::open(&workspace.root)?
            .with_policy(workspace.policy.clone())?
            .with_cancellation(cancel.clone()),
    ))
}
fn tty() -> Result<(), PublicError> {
    if io::stdin().is_terminal() && io::stdout().is_terminal() {
        Ok(())
    } else {
        Err(PublicError::TtyRequired)
    }
}
fn show_root(output: &mut impl Write, reader: &CanonicalWorkspace) -> Result<(), PublicError> {
    writeln!(
        output,
        "{}{}",
        strings::ROOT,
        review_ui::escape(reader.identity().display())
    )
    .and_then(|_| output.flush())
    .map_err(|_| PublicError::OutputUnavailable)
}
fn metadata_guidance(session: &ChatSession, reader: &CanonicalWorkspace, policy: &AccessPolicy) {
    if let Some(count) = session.metadata_attention(reader, policy) {
        let _ = writeln!(
            io::stderr(),
            "{} {count}. {}",
            strings::METADATA_INELIGIBLE,
            strings::METADATA_GUIDANCE
        );
    }
}
fn execute(arguments: Vec<OsString>) -> Result<(), PublicError> {
    let command = args::parse(arguments)?;
    let cancel = Cancellation::default();
    if !matches!(command, Invocation::Help | Invocation::Version) {
        synapse_adapters::install_interrupt(cancel.clone())?;
    }
    let mut output = io::stdout().lock();
    match command {
        Invocation::Mcp {
            workspace,
            action,
            query,
            submit,
            client,
        } => {
            let reader = open(&workspace, &cancel)?;
            let store = Arc::new(DiskStateStore::open(reader.as_ref())?);
            match action.as_str() {
                "grant" => {
                    tty()?;
                    show_root(&mut output, reader.as_ref())?;
                    writeln!(
                        output,
                        "{} query={query} submit={submit}",
                        strings::MCP_GRANT
                    )
                    .and_then(|_| output.flush())
                    .map_err(|_| PublicError::OutputUnavailable)?;
                    if input::Input::start()?.read(&cancel)?.as_deref() != Some("Grant") {
                        return Err(PublicError::ApprovalRequired);
                    }
                    let (id, secret) = store.provision_client(reader.as_ref(), query, submit)?;
                    writeln!(
                        output,
                        "{} {id}\n{} {secret}",
                        strings::MCP_CLIENT,
                        strings::MCP_SECRET
                    )
                    .map_err(|_| PublicError::OutputUnavailable)?;
                }
                "revoke" => {
                    store.revoke_client(client.as_deref().ok_or(PublicError::Usage)?)?;
                    writeln!(output, "{}", strings::MCP_REVOKED)
                        .map_err(|_| PublicError::OutputUnavailable)?;
                }
                "list" => {
                    tty()?;
                    for grant in store.clients()? {
                        writeln!(
                            output,
                            "{} query={} submit={}",
                            grant.id, grant.query, grant.submit
                        )
                        .map_err(|_| PublicError::OutputUnavailable)?;
                    }
                }
                "serve" => {
                    let service = model(workspace.provider, reader.clone(), workspace.policy)?;
                    let listener = synapse_adapters::McpListener::bind()?;
                    writeln!(
                        output,
                        "{} http://127.0.0.1:{}/mcp",
                        strings::MCP_LISTENING,
                        listener.port()?
                    )
                    .and_then(|_| output.flush())
                    .map_err(|_| PublicError::OutputUnavailable)?;
                    listener.serve(reader, store, Arc::from(service), cancel.clone())?;
                }
                _ => return Err(PublicError::Usage),
            }
        }

        Invocation::Contradictions { workspace, json } => {
            let reader = open(&workspace, &cancel)?;
            let store = DiskStateStore::open(reader.as_ref())?;
            let reports = store.contradictions()?;
            if json {
                output::contradictions_json(&mut output, &reports)?;
            } else if reports.is_empty() {
                writeln!(output, "{}", strings::CONTRADICTIONS_EMPTY)
                    .map_err(|_| PublicError::OutputUnavailable)?;
            } else {
                for report in reports {
                    writeln!(
                        output,
                        "{} {} {}",
                        &report.id.as_str()[..12],
                        &report.capture.as_str()[..12],
                        review_ui::escape(&report.summary)
                    )
                    .map_err(|_| PublicError::OutputUnavailable)?;
                }
            }
        }
        Invocation::Recovery { workspace, revert } => {
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            let store = DiskStateStore::open(reader.as_ref())?;
            if let Some(id) = revert {
                let plan = store.revert_plan(
                    reader.as_ref(),
                    &id,
                    provider_fingerprint(&workspace.provider),
                )?;
                review_ui::finish(
                    reader.as_ref(),
                    plan,
                    workspace.preview,
                    &mut output,
                    &cancel,
                )?;
            } else {
                for record in store.history(reader.as_ref())? {
                    let state = match record.outcome {
                        synapse_adapters::WriteOutcome::Unattempted => "unattempted",
                        synapse_adapters::WriteOutcome::Intent => "intent",
                        synapse_adapters::WriteOutcome::Applied => "applied",
                        synapse_adapters::WriteOutcome::Refused => "refused",
                        synapse_adapters::WriteOutcome::Unknown => "unknown",
                    };
                    writeln!(
                        output,
                        "{} {} {}",
                        record.id.as_str(),
                        state,
                        review_ui::escape(record.proposal.target.path.as_str())
                    )
                    .map_err(|_| PublicError::OutputUnavailable)?;
                }
            }
        }
        Invocation::Clear { workspace } => {
            tty()?;
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            writeln!(output, "{}", strings::CLEAR_WARNING)
                .map_err(|_| PublicError::OutputUnavailable)?;
            output.flush().map_err(|_| PublicError::OutputUnavailable)?;
            if input::Input::start()?.read(&cancel)?.as_deref() != Some("Clear") {
                return Err(PublicError::ApprovalRequired);
            }
            DiskStateStore::open(reader.as_ref())?.clear_history(reader.as_ref())?;
            writeln!(output, "{}", strings::CLEARED).map_err(|_| PublicError::OutputUnavailable)?;
        }

        Invocation::Help => {
            write!(output, "{}", strings::HELP).map_err(|_| PublicError::OutputUnavailable)?
        }
        Invocation::Version => writeln!(output, "synapse {}", env!("CARGO_PKG_VERSION"))
            .map_err(|_| PublicError::OutputUnavailable)?,
        Invocation::Doctor { workspace, offline } => {
            let reader = open(&workspace, &cancel)?;
            if offline {
                writeln!(output, "{}", strings::DOCTOR_OFFLINE)
                    .map_err(|_| PublicError::OutputUnavailable)?;
            } else {
                let service = model(workspace.provider, reader, workspace.policy)?;
                let _ = service.execute(ModelJob::Health, Priority::Interactive, &cancel)?;
                writeln!(output, "{}", strings::DOCTOR_READY)
                    .map_err(|_| PublicError::OutputUnavailable)?;
            }
        }
        Invocation::Ask {
            workspace,
            question,
            json,
            stats,
        } => {
            let started = std::time::Instant::now();
            let cancel = cancel.bounded(synapse_core::WORKFLOW_MILLIS, move || {
                started.elapsed().as_millis() as u64
            });
            let reader = open(&workspace, &cancel)?;
            let service = model(workspace.provider, reader.clone(), workspace.policy.clone())?;
            let _ = writeln!(io::stderr(), "{}", strings::INDEX_DISCLOSURE);
            let _ = writeln!(io::stderr(), "{}", strings::SEARCHING);
            let mut session =
                synapse_adapters::query_session(reader.as_ref(), workspace.policy.clone())?;
            metadata_guidance(&session, reader.as_ref(), &workspace.policy);
            let answer = session.ask(
                &question,
                reader.as_ref(),
                &workspace.policy,
                service.as_ref(),
                &cancel,
            );
            if stats {
                let usage = session.stats();
                let _ = writeln!(
                    io::stderr(),
                    "{} calls={} prompt_tokens={} candidates={} served={} final={} elapsed_ms={} completion_tokens={}",
                    strings::QUERY_STATS,
                    usage.calls,
                    usage.prompt_tokens,
                    usage.candidate_ranges,
                    usage.served_ranges,
                    usage.final_ranges,
                    started.elapsed().as_millis(),
                    usage.completion_tokens
                );
            }
            let answer = answer?;
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            output::answer(&mut output, &answer, json)?;
        }
        Invocation::Search {
            workspace,
            terms,
            json,
        } => {
            let reader = open(&workspace, &cancel)?;
            let mut session =
                synapse_adapters::query_session(reader.as_ref(), workspace.policy.clone())?;
            metadata_guidance(&session, reader.as_ref(), &workspace.policy);
            let answer = session.search(&terms, reader.as_ref(), &workspace.policy)?;
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            output::answer(&mut output, &answer, json)?;
        }
        Invocation::Capture {
            workspace,
            file,
            range,
        } => {
            let reader = open(&workspace, &cancel)?;
            let store = DiskStateStore::open(reader.as_ref())?;
            let id = synapse_core::capture_research(reader.as_ref(), &store, &file, range)?;
            writeln!(output, "{}{}", strings::CAPTURED, id.as_str())
                .map_err(|_| PublicError::OutputUnavailable)?;
        }
        Invocation::Setup { workspace } => {
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            let plan = synapse_core::setup_preview(
                reader.as_ref(),
                provider_fingerprint(&workspace.provider),
            )?;
            review_ui::finish(
                reader.as_ref(),
                plan,
                workspace.preview,
                &mut output,
                &cancel,
            )?;
        }
        Invocation::MetadataReview { workspace, file } => {
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            let fingerprint = provider_fingerprint(&workspace.provider);
            let service = model(workspace.provider, reader.clone(), workspace.policy)?;
            review_ui::metadata(
                reader,
                service.as_ref(),
                fingerprint,
                (file, workspace.preview),
                &mut output,
                &cancel,
            )?;
        }
        Invocation::ResearchReview {
            workspace,
            capture,
            date,
        } => {
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            let store = DiskStateStore::open(reader.as_ref())?;
            let fingerprint = provider_fingerprint(&workspace.provider);
            let service = model(workspace.provider, reader.clone(), workspace.policy)?;
            review_ui::research(
                reader,
                &store,
                service.as_ref(),
                fingerprint,
                review_ui::ResearchSelection {
                    capture,
                    date,
                    preview: workspace.preview,
                },
                &mut output,
                &cancel,
            )?;
        }
        Invocation::Interactive { workspace } => {
            tty()?;
            let reader = open(&workspace, &cancel)?;
            show_root(&mut output, reader.as_ref())?;
            let service = model(workspace.provider, reader.clone(), workspace.policy.clone())?;
            let _watcher = PollingWatcher::start(reader.clone())?;
            let mut session =
                synapse_adapters::query_session(reader.as_ref(), workspace.policy.clone())?;
            metadata_guidance(&session, reader.as_ref(), &workspace.policy);
            let input = input::Input::start()?;
            writeln!(output, "{}", strings::INDEX_DISCLOSURE)
                .map_err(|_| PublicError::OutputUnavailable)?;
            writeln!(output, "{}", strings::SESSION_HELP)
                .map_err(|_| PublicError::OutputUnavailable)?;
            loop {
                write!(output, "{}", strings::PROMPT)
                    .and_then(|_| output.flush())
                    .map_err(|_| PublicError::OutputUnavailable)?;
                let Some(line) = input.read(&cancel)? else {
                    break;
                };
                let action = (|| -> Result<bool, PublicError> {
                    match line.trim() {
                        "" => (),
                        "/quit" => return Ok(false),
                        "/help" => writeln!(output, "{}", strings::SESSION_HELP)
                            .map_err(|_| PublicError::OutputUnavailable)?,
                        "/reset" => {
                            session.reset();
                            writeln!(output, "{}", strings::RESET)
                                .map_err(|_| PublicError::OutputUnavailable)?;
                        }
                        source if source.starts_with("/source ") => {
                            let ordinal = source[8..].parse().map_err(|_| PublicError::Usage)?;
                            let passage =
                                session.inspect(ordinal, reader.as_ref(), &workspace.policy)?;
                            if cancel.is_cancelled() {
                                return Err(PublicError::Cancelled);
                            }
                            output::source(&mut output, &passage)?;
                        }
                        search if search.starts_with("/search ") => {
                            let answer =
                                session.search(&search[8..], reader.as_ref(), &workspace.policy)?;
                            output::answer(&mut output, &answer, false)?;
                        }
                        unknown if unknown.starts_with('/') => return Err(PublicError::Usage),
                        question => {
                            let _ = writeln!(io::stderr(), "{}", strings::SEARCHING);
                            let started = std::time::Instant::now();
                            let query_cancel = cancel
                                .bounded(synapse_core::WORKFLOW_MILLIS, move || {
                                    started.elapsed().as_millis() as u64
                                });
                            let answer = session.ask(
                                question,
                                reader.as_ref(),
                                &workspace.policy,
                                service.as_ref(),
                                &query_cancel,
                            )?;
                            if cancel.is_cancelled() {
                                return Err(PublicError::Cancelled);
                            }
                            output::answer(&mut output, &answer, false)?;
                        }
                    }
                    Ok(true)
                })();
                if cancel.is_cancelled() {
                    return Err(PublicError::Cancelled);
                }
                match action {
                    Ok(false) => break,
                    Ok(true) => (),
                    Err(PublicError::Cancelled) => return Err(PublicError::Cancelled),
                    Err(error) => {
                        let _ = writeln!(io::stderr(), "synapse: {}", error.code());
                    }
                }
            }
        }
    }
    if cancel.is_cancelled() {
        return Err(PublicError::Cancelled);
    }
    output.flush().map_err(|_| PublicError::OutputUnavailable)
}
pub fn run(args: Vec<OsString>) -> ExitCode {
    let json = args.iter().any(|arg| arg == "--json");
    match execute(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            if json {
                let _ = output::error_json(&mut io::stdout(), error);
            }
            let _ = writeln!(io::stderr(), "synapse: {}", error.code());
            ExitCode::from(error.exit_code())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_terminal_controls_and_direction_overrides() {
        assert_eq!(sanitize("a\x1b[2J\r\n\u{202e}b"), "a[2Jb");
    }
}
