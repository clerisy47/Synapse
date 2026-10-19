use crate::{input::Input, output, strings};
use std::{io::Write, sync::Arc};
use synapse_adapters::{CanonicalWorkspace, DiskStateStore};
use synapse_core::{
    Cancellation, ContentHash, ControlFile, DailyDate, FileSnapshot, ModelJob, ModelResult,
    ModelService, NotePath, Priority, ProposalReadPort, PublicError, ReviewPlan, StateStore,
};

pub fn escape(value: &str) -> String {
    let mut result = String::new();
    for c in value.chars() {
        match c {
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            c if c.is_control()
                || matches!(c,'\u{061c}'|'\u{200b}'..='\u{200f}'|'\u{2028}'..='\u{202e}'|'\u{2060}'..='\u{206f}'|'\u{feff}') =>
            {
                result.push_str(&format!("\\u{{{:x}}}", u32::from(c)))
            }
            c => result.push(c),
        }
    }
    result
}
fn read(input: &Input, cancel: &Cancellation) -> Result<String, PublicError> {
    input.read(cancel)?.ok_or(PublicError::ApprovalRequired)
}
fn current(
    reader: &CanonicalWorkspace,
    snapshot: &FileSnapshot,
) -> Result<FileSnapshot, PublicError> {
    if snapshot.path == reader.access_policy().instructions {
        reader.snapshot_control(ControlFile::Instructions)
    } else if snapshot.path == reader.access_policy().research {
        reader.snapshot_control(ControlFile::Research)
    } else {
        reader.snapshot_note(&snapshot.path)
    }
}
pub fn validate(reader: &CanonicalWorkspace, plan: &ReviewPlan) -> Result<(), PublicError> {
    if plan.policy != synapse_core::policy_fingerprint(reader.access_policy()) {
        return Err(PublicError::Conflict);
    }
    for proposal in &plan.proposals {
        if !synapse_core::proposal_access(reader.access_policy(), proposal) {
            return Err(PublicError::AccessRefused);
        }
        if current(reader, &proposal.target)? != proposal.target {
            return Err(PublicError::Conflict);
        }
        for source in &proposal.sources {
            if current(reader, source)? != *source {
                return Err(PublicError::Conflict);
            }
        }
    }
    Ok(())
}
fn text_rows(prefix: &str, text: &str, columns: usize) -> Vec<String> {
    let mut rows = Vec::new();
    if text.is_empty() {
        rows.push(format!("{prefix}{}", strings::EMPTY_BYTES));
    }
    for line in text.split_inclusive('\n') {
        for row in output::wrap(&escape(line), columns.saturating_sub(prefix.len()).max(1)) {
            rows.push(format!("{prefix}{row}"));
        }
    }
    rows
}
pub fn review(
    reader: &CanonicalWorkspace,
    plan: ReviewPlan,
    output: &mut impl Write,
    cancel: &Cancellation,
) -> Result<ReviewPlan, PublicError> {
    validate(reader, &plan)?;
    let input = Input::start()?;
    let mut accepted = Vec::new();
    for proposal in plan.proposals {
        let columns = synapse_adapters::terminal_columns();
        let mut rows = output::wrap(
            &format!(
                "{}{}",
                strings::TARGET,
                escape(proposal.target.path.as_str())
            ),
            columns,
        );
        for parent in &proposal.target.parents {
            if parent.identity.is_none() {
                rows.extend(output::wrap(
                    &format!("{}{}", strings::CREATE_FOLDER, escape(&parent.path)),
                    columns,
                ));
            }
        }
        rows.extend(output::wrap(strings::BEFORE, columns));
        rows.extend(text_rows(
            "- ",
            proposal.target.before.as_deref().unwrap_or(""),
            columns,
        ));
        rows.extend(output::wrap(strings::AFTER, columns));
        rows.extend(text_rows("+ ", &proposal.after, columns));
        let page_rows = synapse_adapters::terminal_rows()
            .saturating_sub(4)
            .clamp(4, 40);
        let pages = rows.chunks(page_rows);
        let page_count = pages.len();
        let mut complete = true;
        for (index, page) in pages.enumerate() {
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            for line in page {
                writeln!(output, "{line}").map_err(|_| PublicError::OutputUnavailable)?;
            }
            if index + 1 < page_count {
                write!(output, "{}", strings::NEXT_PAGE)
                    .map_err(|_| PublicError::OutputUnavailable)?;
                output.flush().map_err(|_| PublicError::OutputUnavailable)?;
                if read(&input, cancel)? != "next" {
                    complete = false;
                    break;
                }
            }
        }
        if complete {
            write!(output, "{}", strings::ACCEPT_FILE)
                .map_err(|_| PublicError::OutputUnavailable)?;
            output.flush().map_err(|_| PublicError::OutputUnavailable)?;
            match read(&input, cancel)?.as_str() {
                "accept" => accepted.push(proposal),
                "skip" => (),
                _ => return Err(PublicError::ApprovalRequired),
            }
        }
    }
    let accepted = ReviewPlan {
        proposals: accepted,
        policy: plan.policy,
        provider: plan.provider,
    };
    validate(reader, &accepted)?;
    Ok(accepted)
}
pub fn finish(
    reader: &CanonicalWorkspace,
    plan: ReviewPlan,
    preview: bool,
    output: &mut impl Write,
    cancel: &Cancellation,
) -> Result<(), PublicError> {
    if plan.proposals.is_empty() {
        writeln!(output, "{}", strings::NO_CHANGES).map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    }
    let store = DiskStateStore::open(reader)?;
    let _ = store.history(reader)?;
    let accepted = review(reader, plan, output, cancel)?;
    if preview || accepted.proposals.is_empty() {
        writeln!(output, "{}", strings::PREVIEW_ONLY)
            .map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    }
    writeln!(output, "{}", strings::RETENTION).map_err(|_| PublicError::OutputUnavailable)?;
    let approval = store.local_approval(reader, &accepted)?;
    write!(output, "{}", strings::APPLY_PROMPT)
        .and_then(|_| output.flush())
        .map_err(|_| PublicError::OutputUnavailable)?;
    let input = Input::start()?;
    if read(&input, cancel)? != "Apply" {
        return Err(PublicError::ApprovalRequired);
    }
    let count = store.apply_reviewed(reader, accepted, approval)?;
    writeln!(output, "{} {count}", strings::APPLIED).map_err(|_| PublicError::OutputUnavailable)
}
pub fn metadata(
    reader: Arc<CanonicalWorkspace>,
    service: &dyn ModelService,
    provider: ContentHash,
    selection: (Option<NotePath>, bool),
    output: &mut impl Write,
    cancel: &Cancellation,
) -> Result<(), PublicError> {
    let (file, preview) = selection;
    let input = Input::start()?;
    let file = match file {
        Some(file) => file,
        None => {
            let corpus =
                synapse_core::Corpus::build(reader.as_ref(), reader.access_policy().clone())?;
            let paths = corpus.attention(reader.as_ref(), reader.access_policy());
            if paths.is_empty() {
                writeln!(output, "{}", strings::NO_CHANGES)
                    .map_err(|_| PublicError::OutputUnavailable)?;
                return Ok(());
            }
            for (index, path) in paths.iter().take(20).enumerate() {
                writeln!(output, "{} {}", index + 1, escape(path.as_str()))
                    .map_err(|_| PublicError::OutputUnavailable)?;
            }
            write!(output, "{}", strings::SELECT_NOTE)
                .map_err(|_| PublicError::OutputUnavailable)?;
            output.flush().map_err(|_| PublicError::OutputUnavailable)?;
            let selected: usize = read(&input, cancel)?
                .parse()
                .map_err(|_| PublicError::Usage)?;
            paths
                .get(selected.checked_sub(1).ok_or(PublicError::Usage)?)
                .filter(|_| selected <= 20)
                .ok_or(PublicError::Usage)?
                .clone()
        }
    };
    let snapshot = reader.snapshot_note(&file)?;
    let Some(metadata) = synapse_core::metadata_input(snapshot, reader.access_policy())? else {
        writeln!(output, "{}", strings::NO_CHANGES).map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    };
    let fields = match service.execute(
        ModelJob::RepairMetadata {
            input: metadata.clone(),
        },
        Priority::Interactive,
        cancel,
    )? {
        ModelResult::Metadata(fields) => fields,
        _ => return Err(PublicError::InvalidModelOutput),
    };
    let proposal = synapse_core::metadata_proposal(reader.as_ref(), metadata, fields)?;
    let plan = ReviewPlan {
        proposals: vec![proposal],
        policy: synapse_core::policy_fingerprint(reader.access_policy()),
        provider,
    };
    finish(reader.as_ref(), plan, preview, output, cancel)
}
pub struct ResearchSelection {
    pub preview: bool,
    pub capture: Option<usize>,
    pub date: Option<DailyDate>,
}
pub fn research(
    reader: Arc<CanonicalWorkspace>,
    store: &DiskStateStore,
    service: &dyn ModelService,
    provider: ContentHash,
    selection: ResearchSelection,
    output: &mut impl Write,
    cancel: &Cancellation,
) -> Result<(), PublicError> {
    let preview = selection.preview;
    let selected = selection.capture;
    let mut date = selection.date;
    let inbox = reader.snapshot_control(ControlFile::Research)?;
    let bytes = inbox.before.as_deref().ok_or(PublicError::Usage)?;
    if synapse_core::source_excluded(bytes, reader.access_policy()) {
        return Err(PublicError::AccessRefused);
    }
    let captures: Vec<_> = store
        .captures()?
        .into_iter()
        .filter(|capture| {
            capture.source == reader.access_policy().research
                && capture.source_hash == ContentHash::of(bytes.as_bytes())
        })
        .collect();
    if captures.is_empty() {
        return Err(PublicError::Conflict);
    }
    let input = Input::start()?;
    let selected = match selected {
        Some(selected) => selected,
        None => {
            for (index, capture) in captures.iter().enumerate() {
                writeln!(
                    output,
                    "{} {} {}-{}",
                    index + 1,
                    &capture.id.as_str()[..12],
                    capture.start_line,
                    capture.end_line
                )
                .map_err(|_| PublicError::OutputUnavailable)?;
            }
            write!(output, "{}", strings::SELECT_CAPTURE)
                .map_err(|_| PublicError::OutputUnavailable)?;
            output.flush().map_err(|_| PublicError::OutputUnavailable)?;
            read(&input, cancel)?
                .parse()
                .map_err(|_| PublicError::Usage)?
        }
    };
    let capture = captures
        .get(selected.checked_sub(1).ok_or(PublicError::Usage)?)
        .ok_or(PublicError::Usage)?;
    let instructions = reader.snapshot_control(ControlFile::Instructions)?;
    let routes = synapse_core::parse_instructions(
        instructions
            .before
            .as_deref()
            .ok_or(PublicError::InvalidInstructions)?,
        reader.access_policy(),
    )?;
    let draft = match service.execute(
        ModelJob::DraftResearch {
            capture: capture.clone(),
            instructions: instructions.clone(),
        },
        Priority::Interactive,
        cancel,
    )? {
        ModelResult::Draft(draft) => draft,
        _ => return Err(PublicError::InvalidModelOutput),
    };
    let Some(draft) = draft else {
        writeln!(output, "{}", strings::NO_SUPPORTED_RESEARCH)
            .map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    };
    if routes
        .daily
        .as_ref()
        .is_some_and(|daily| daily.id == draft.destination_id)
        && date.is_none()
    {
        write!(output, "{}", strings::SELECT_DATE).map_err(|_| PublicError::OutputUnavailable)?;
        output.flush().map_err(|_| PublicError::OutputUnavailable)?;
        date = Some(DailyDate::parse(&read(&input, cancel)?)?);
    }
    let proposal = synapse_core::research_proposal(
        reader.as_ref(),
        capture,
        &instructions,
        draft,
        date.as_ref(),
    )?;
    let plan = ReviewPlan {
        proposals: vec![proposal],
        policy: synapse_core::policy_fingerprint(reader.access_policy()),
        provider,
    };
    finish(reader.as_ref(), plan, preview, output, cancel)
}
