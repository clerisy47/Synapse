use crate::{output, strings};
use std::{io::Write, sync::Arc};
use synapse_adapters::{CanonicalWorkspace, DiskStateStore};
use synapse_core::{
    Cancellation, Clock, ContentHash, ControlFile, DailyDate, ModelJob, ModelResult, ModelService,
    NotePath, Priority, Proposal, ProposalKind, ProposalReadPort, PublicError, ReviewPlan,
    StateStore,
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
fn current(
    reader: &CanonicalWorkspace,
    snapshot: &synapse_core::FileSnapshot,
) -> Result<synapse_core::FileSnapshot, PublicError> {
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
fn summarize(plan: &ReviewPlan, output: &mut impl Write) -> Result<(), PublicError> {
    let columns = synapse_adapters::terminal_columns();
    for proposal in &plan.proposals {
        let label = match proposal.kind {
            ProposalKind::Delete => "delete",
            ProposalKind::Rename => "rename",
            ProposalKind::Setup => "setup",
            ProposalKind::Metadata => "metadata",
            ProposalKind::Research => "research",
            ProposalKind::Revert => "revert",
        };
        let mut rows = output::wrap(
            &format!(
                "{}{} ({label})",
                strings::TARGET,
                escape(proposal.target.path.as_str())
            ),
            columns,
        );
        if let Some(dest) = &proposal.rename_to {
            rows.extend(output::wrap(
                &format!("Rename to: {}", escape(dest.as_str())),
                columns,
            ));
        }
        for parent in &proposal.target.parents {
            if parent.identity.is_none() {
                rows.extend(output::wrap(
                    &format!("{}{}", strings::CREATE_FOLDER, escape(&parent.path)),
                    columns,
                ));
            }
        }
        if proposal.kind != ProposalKind::Delete && proposal.kind != ProposalKind::Rename {
            rows.extend(output::wrap(strings::BEFORE, columns));
            rows.extend(text_rows(
                "- ",
                proposal.target.before.as_deref().unwrap_or(""),
                columns,
            ));
            rows.extend(output::wrap(strings::AFTER, columns));
            rows.extend(text_rows("+ ", &proposal.after, columns));
        }
        for line in rows {
            writeln!(output, "{line}").map_err(|_| PublicError::OutputUnavailable)?;
        }
    }
    Ok(())
}
pub fn finish(
    reader: &CanonicalWorkspace,
    plan: ReviewPlan,
    preview: bool,
    output: &mut impl Write,
    _cancel: &Cancellation,
) -> Result<(), PublicError> {
    if plan.proposals.is_empty() {
        writeln!(output, "{}", strings::NO_CHANGES).map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    }
    validate(reader, &plan)?;
    summarize(&plan, output)?;
    if preview {
        writeln!(output, "{}", strings::PREVIEW_ONLY)
            .map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    }
    writeln!(output, "{}", strings::RETENTION).map_err(|_| PublicError::OutputUnavailable)?;
    let store = DiskStateStore::open(reader)?;
    let _ = store.history(reader)?;
    let count = store.apply_auto(reader, plan)?;
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
    let (selected_file, preview) = selection;
    let single = selected_file.is_some();
    let paths = match selected_file {
        Some(file) => vec![file],
        None => {
            let corpus =
                synapse_core::Corpus::build(reader.as_ref(), reader.access_policy().clone())?;
            corpus.attention(reader.as_ref(), reader.access_policy())
        }
    };
    if paths.is_empty() {
        writeln!(output, "{}", strings::NO_CHANGES).map_err(|_| PublicError::OutputUnavailable)?;
        return Ok(());
    }
    let mut proposals = Vec::new();
    for file in paths {
        let snapshot = reader.snapshot_note(&file)?;
        let metadata = match synapse_core::metadata_input(snapshot, reader.access_policy()) {
            Err(error @ (PublicError::InvalidMetadata | PublicError::ResourceLimit)) => {
                writeln!(output, "{}", strings::METADATA_MANUAL)
                    .map_err(|_| PublicError::OutputUnavailable)?;
                if single {
                    return Err(error);
                }
                continue;
            }
            result => result?,
        };
        let Some(metadata) = metadata else {
            continue;
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
        proposals.push(synapse_core::metadata_proposal(
            reader.as_ref(),
            metadata,
            fields,
        )?);
    }
    let plan = ReviewPlan {
        proposals,
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
fn inventory(reader: &CanonicalWorkspace) -> Result<Vec<(String, NotePath)>, PublicError> {
    let corpus = synapse_core::Corpus::build(reader, reader.access_policy().clone())?;
    let mut items = Vec::new();
    for (index, path) in corpus
        .attention(reader, reader.access_policy())
        .into_iter()
        .take(32)
        .enumerate()
    {
        let id = format!("inv-{}", index + 1);
        items.push((id, path));
    }
    Ok(items)
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
    let date = selection.date;
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
    let captures: Vec<_> = match selected {
        Some(selected) => {
            let capture = captures
                .get(selected.checked_sub(1).ok_or(PublicError::Usage)?)
                .ok_or(PublicError::Usage)?;
            vec![capture.clone()]
        }
        None => captures,
    };
    let instructions = reader.snapshot_control(ControlFile::Instructions)?;
    let routes = synapse_core::parse_instructions(
        instructions
            .before
            .as_deref()
            .ok_or(PublicError::InvalidInstructions)?,
        reader.access_policy(),
    )?;
    let inventory = inventory(reader.as_ref())?;
    let mut proposals: Vec<Proposal> = Vec::new();
    let mut flags = Vec::new();
    for capture in &captures {
        let draft = match service.execute(
            ModelJob::DraftResearch {
                capture: capture.clone(),
                instructions: instructions.clone(),
                inventory: inventory.clone(),
            },
            Priority::Interactive,
            cancel,
        )? {
            ModelResult::Draft(draft) => draft,
            _ => return Err(PublicError::InvalidModelOutput),
        };
        let Some(draft) = draft else {
            writeln!(
                output,
                "{} {}",
                strings::NO_SUPPORTED_RESEARCH,
                &capture.id.as_str()[..12]
            )
            .map_err(|_| PublicError::OutputUnavailable)?;
            continue;
        };
        let needs_date = draft.ops.iter().any(|op| {
            routes
                .daily
                .as_ref()
                .is_some_and(|daily| daily.id == op.destination_id)
        }) || routes
            .daily
            .as_ref()
            .is_some_and(|daily| daily.id == draft.destination_id);
        if needs_date && date.is_none() {
            return Err(PublicError::DateRequired);
        }
        let built = synapse_core::research_proposals(
            reader.as_ref(),
            capture,
            &instructions,
            &draft,
            date.as_ref(),
            &inventory,
        )?;
        let bodies: Vec<_> = built
            .iter()
            .filter_map(|proposal| {
                proposal
                    .target
                    .before
                    .as_ref()
                    .map(|before| (proposal.target.path.clone(), before.clone()))
            })
            .collect();
        let assessment = if bodies.is_empty() {
            synapse_core::ContradictionAssessment {
                severity: synapse_core::ContradictionSeverity::None,
                summary: String::new(),
                destinations: Vec::new(),
            }
        } else {
            match service.execute(
                ModelJob::AssessContradiction {
                    capture: capture.clone(),
                    destinations: bodies,
                },
                Priority::Interactive,
                cancel,
            )? {
                ModelResult::Contradiction(assessment) => assessment,
                _ => return Err(PublicError::InvalidModelOutput),
            }
        };
        if assessment.severity == synapse_core::ContradictionSeverity::High {
            let report = synapse_core::ContradictionReport {
                id: ContentHash::combined(&[
                    capture.id.as_str().as_bytes(),
                    assessment.summary.as_bytes(),
                ]),
                capture: capture.id.clone(),
                severity: assessment.severity,
                summary: assessment.summary.clone(),
                destinations: assessment.destinations.clone(),
                created: reader.unix_seconds()?,
            };
            flags.push(report.clone());
            store.save_contradiction(report)?;
            writeln!(
                output,
                "{} {} {}",
                strings::CONTRADICTION_FLAG,
                &capture.id.as_str()[..12],
                escape(&assessment.summary)
            )
            .map_err(|_| PublicError::OutputUnavailable)?;
        }
        proposals.extend(built);
    }
    let plan = ReviewPlan {
        proposals,
        policy: synapse_core::policy_fingerprint(reader.access_policy()),
        provider,
    };
    let _ = flags;
    finish(reader.as_ref(), plan, preview, output, cancel)
}
