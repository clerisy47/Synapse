//! Argument parsing and plain-text terminal boundary.
mod args;
mod input;
mod output;
mod strings;
use args::{Invocation, ProviderChoice};
use std::{
    ffi::OsString,
    io::{self, IsTerminal, Write},
    process::ExitCode,
    sync::Arc,
};
use synapse_adapters::{CanonicalWorkspace, PollingWatcher};
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, ModelJob, ModelService, Priority, PublicError,
    WorkspaceReadPort,
};

pub fn sanitize(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() && !matches!(*c,
        '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}'
    )).collect()
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
fn execute(args: Vec<OsString>) -> Result<(), PublicError> {
    let command = args::parse(args)?;
    let cancel = Cancellation::default();
    if !matches!(command, Invocation::Help | Invocation::Version) {
        synapse_adapters::install_interrupt(cancel.clone())?;
    }
    let mut stdout = io::stdout().lock();
    match command {
        Invocation::Help => {
            write!(stdout, "{}", strings::HELP).map_err(|_| PublicError::OutputUnavailable)?
        }
        Invocation::Version => writeln!(stdout, "synapse {}", env!("CARGO_PKG_VERSION"))
            .map_err(|_| PublicError::OutputUnavailable)?,
        Invocation::Doctor {
            root,
            offline,
            provider,
        } => {
            let reader =
                Arc::new(CanonicalWorkspace::open(&root)?.with_cancellation(cancel.clone()));
            if offline {
                writeln!(stdout, "{}", strings::DOCTOR_OFFLINE)
                    .map_err(|_| PublicError::OutputUnavailable)?;
            } else {
                let service = model(provider, reader, AccessPolicy::default())?;
                let _ = service.execute(ModelJob::Health, Priority::Interactive, &cancel)?;
                writeln!(stdout, "{}", strings::DOCTOR_READY)
                    .map_err(|_| PublicError::OutputUnavailable)?;
            }
        }
        Invocation::Ask {
            root,
            question,
            json,
            provider,
        } => {
            let reader =
                Arc::new(CanonicalWorkspace::open(&root)?.with_cancellation(cancel.clone()));
            let policy = AccessPolicy::default();
            let service = model(provider, reader.clone(), policy.clone())?;
            let _ = writeln!(io::stderr(), "{}", strings::SEARCHING);
            let mut session = ChatSession::new(reader.as_ref(), policy.clone())?;
            let answer = session.ask(
                &question,
                reader.as_ref(),
                &policy,
                service.as_ref(),
                &cancel,
            )?;
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            output::answer(&mut stdout, &answer, json)?;
        }
        Invocation::Interactive { root, provider } => {
            if !io::stdin().is_terminal() || !io::stdout().is_terminal() {
                return Err(PublicError::TtyRequired);
            }
            let reader =
                Arc::new(CanonicalWorkspace::open(&root)?.with_cancellation(cancel.clone()));
            writeln!(
                stdout,
                "{}{}",
                strings::ROOT,
                sanitize(reader.identity().display())
            )
            .map_err(|_| PublicError::OutputUnavailable)?;
            stdout.flush().map_err(|_| PublicError::OutputUnavailable)?;
            let policy = AccessPolicy::default();
            let service = model(provider, reader.clone(), policy.clone())?;
            let _watcher = PollingWatcher::start(reader.clone())?;
            let mut session = ChatSession::new(reader.as_ref(), policy.clone())?;
            let input = input::Input::start()?;
            writeln!(stdout, "{}", strings::SESSION_HELP)
                .map_err(|_| PublicError::OutputUnavailable)?;
            loop {
                write!(stdout, "{}", strings::PROMPT)
                    .map_err(|_| PublicError::OutputUnavailable)?;
                stdout.flush().map_err(|_| PublicError::OutputUnavailable)?;
                let Some(line) = input.read(&cancel)? else {
                    break;
                };
                let action = (|| -> Result<bool, PublicError> {
                    match line.trim() {
                        "" => (),
                        "/quit" => return Ok(false),
                        "/help" => writeln!(stdout, "{}", strings::SESSION_HELP)
                            .map_err(|_| PublicError::OutputUnavailable)?,
                        "/reset" => {
                            session.reset();
                            writeln!(stdout, "{}", strings::RESET)
                                .map_err(|_| PublicError::OutputUnavailable)?;
                        }
                        source if source.starts_with("/source ") => {
                            let ordinal = source[8..].parse().map_err(|_| PublicError::Usage)?;
                            let passage = session.inspect(ordinal, reader.as_ref(), &policy)?;
                            if cancel.is_cancelled() {
                                return Err(PublicError::Cancelled);
                            }
                            output::source(&mut stdout, &passage)?;
                        }
                        unknown if unknown.starts_with('/') => return Err(PublicError::Usage),
                        question => {
                            let _ = writeln!(io::stderr(), "{}", strings::SEARCHING);
                            let answer = session.ask(
                                question,
                                reader.as_ref(),
                                &policy,
                                service.as_ref(),
                                &cancel,
                            )?;
                            if cancel.is_cancelled() {
                                return Err(PublicError::Cancelled);
                            }
                            output::answer(&mut stdout, &answer, false)?;
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
    stdout.flush().map_err(|_| PublicError::OutputUnavailable)
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
