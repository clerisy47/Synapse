//! Journaled auto-apply for local note mutations. No interactive Apply gate.
use crate::{CanonicalWorkspace, DiskStateStore, state_store::StateFile};
use serde::{Deserialize, Serialize};
use std::io::IsTerminal;
use synapse_core::{
    Clock, ContentHash, ControlFile, Proposal, ProposalKind, ProposalReadPort, PublicError,
    ReviewPlan,
};
const MAX_RECORDS: usize = 20;
const MAX_JOURNAL_BYTES: u64 = 4_000_000;
const RETAIN_SECONDS: u64 = 30 * 24 * 60 * 60;
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    Unattempted,
    Intent,
    Applied,
    Refused,
    Unknown,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct JournalRecord {
    pub id: ContentHash,
    pub created: u64,
    pub proposal: Proposal,
    pub outcome: WriteOutcome,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    workspace: ContentHash,
    epoch: u64,
    records: Vec<JournalRecord>,
}
/// Retained for test compatibility; production apply no longer requires it.
pub struct LocalApproval {
    fingerprint: ContentHash,
    epoch: u64,
}
fn snapshot(
    reader: &CanonicalWorkspace,
    path: &synapse_core::NotePath,
) -> Result<synapse_core::FileSnapshot, PublicError> {
    if *path == reader.access_policy().instructions {
        reader.snapshot_control(ControlFile::Instructions)
    } else if *path == reader.access_policy().research {
        reader.snapshot_control(ControlFile::Research)
    } else {
        reader.snapshot_note(path)
    }
}
fn validate(reader: &CanonicalWorkspace, plan: &ReviewPlan) -> Result<(), PublicError> {
    if plan.policy != synapse_core::policy_fingerprint(reader.access_policy()) {
        return Err(PublicError::Conflict);
    }
    for p in &plan.proposals {
        if !synapse_core::proposal_access(reader.access_policy(), p) {
            return Err(PublicError::AccessRefused);
        }
        if snapshot(reader, &p.target.path)? != p.target {
            return Err(PublicError::Conflict);
        }
        if let Some(dest) = &p.rename_to {
            let current = snapshot(reader, dest)?;
            if current.before.is_some() {
                return Err(PublicError::Conflict);
            }
        }
        for source in &p.sources {
            if snapshot(reader, &source.path)? != *source {
                return Err(PublicError::Conflict);
            }
        }
    }
    Ok(())
}
fn outcome_of(
    reader: &CanonicalWorkspace,
    proposal: &Proposal,
) -> Result<WriteOutcome, PublicError> {
    match proposal.kind {
        ProposalKind::Delete => match snapshot(reader, &proposal.target.path) {
            Ok(current) if current.before.is_none() => Ok(WriteOutcome::Applied),
            Ok(current) if current.before == proposal.target.before => Ok(WriteOutcome::Refused),
            Ok(_) => Ok(WriteOutcome::Unknown),
            Err(_) => Ok(WriteOutcome::Unknown),
        },
        ProposalKind::Rename => {
            let Some(dest) = &proposal.rename_to else {
                return Ok(WriteOutcome::Unknown);
            };
            let source = snapshot(reader, &proposal.target.path)?;
            let destination = snapshot(reader, dest)?;
            if source.before.is_none()
                && destination.before.as_deref() == Some(proposal.after.as_str())
            {
                Ok(WriteOutcome::Applied)
            } else if source.before == proposal.target.before && destination.before.is_none() {
                Ok(WriteOutcome::Refused)
            } else {
                Ok(WriteOutcome::Unknown)
            }
        }
        _ => match snapshot(reader, &proposal.target.path) {
            Ok(current) if current.before.as_deref() == Some(proposal.after.as_str()) => {
                Ok(WriteOutcome::Applied)
            }
            Ok(current) if current.before == proposal.target.before => Ok(WriteOutcome::Refused),
            _ => Ok(WriteOutcome::Unknown),
        },
    }
}
fn apply_one(reader: &CanonicalWorkspace, proposal: &Proposal) -> Result<(), PublicError> {
    match proposal.kind {
        ProposalKind::Delete => reader.delete_reviewed(&proposal.target),
        ProposalKind::Rename => {
            let dest = proposal
                .rename_to
                .as_ref()
                .ok_or(PublicError::InvalidModelOutput)?;
            reader.rename_reviewed(&proposal.target, dest)
        }
        _ => reader.replace_reviewed(&proposal.target, &proposal.after, proposal.kind),
    }
}
impl DiskStateStore {
    fn journal(&self, reader: &CanonicalWorkspace) -> Result<Journal, PublicError> {
        self.assert_workspace(reader)?;
        let Some(bytes) = self.read_state(StateFile::Journal, MAX_JOURNAL_BYTES)? else {
            return Ok(Journal {
                version: 1,
                workspace: reader.workspace_id()?,
                epoch: 0,
                records: Vec::new(),
            });
        };
        let mut journal: Journal =
            serde_json::from_slice(&bytes).map_err(|_| PublicError::StateUnavailable)?;
        if journal.version != 1
            || journal.workspace != reader.workspace_id()?
            || journal.records.len() > MAX_RECORDS
        {
            return Err(PublicError::StateUnavailable);
        }
        let now = reader.unix_seconds()?;
        let count = journal.records.len();
        journal.records.retain(|record| {
            now.saturating_sub(record.created) <= RETAIN_SECONDS
                || matches!(record.outcome, WriteOutcome::Intent | WriteOutcome::Unknown)
        });
        if count != journal.records.len() {
            self.save_journal(&journal)?;
        }
        Ok(journal)
    }
    fn save_journal(&self, journal: &Journal) -> Result<(), PublicError> {
        let bytes = serde_json::to_vec(journal).map_err(|_| PublicError::StateUnavailable)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(PublicError::CapacityExceeded);
        }
        self.write_state(StateFile::Journal, &bytes)
    }
    fn reconcile_locked(
        &self,
        reader: &CanonicalWorkspace,
        journal: &mut Journal,
    ) -> Result<(), PublicError> {
        let mut changed = false;
        for record in &mut journal.records {
            if matches!(record.outcome, WriteOutcome::Intent | WriteOutcome::Unknown) {
                let outcome = outcome_of(reader, &record.proposal)?;
                changed |= record.outcome != outcome;
                record.outcome = outcome;
            }
        }
        if changed {
            self.save_journal(journal)?;
        }
        Ok(())
    }
    pub fn history(&self, reader: &CanonicalWorkspace) -> Result<Vec<JournalRecord>, PublicError> {
        let _lock = self.lock()?;
        let mut journal = self.journal(reader)?;
        self.reconcile_locked(reader, &mut journal)?;
        Ok(journal.records)
    }
    pub fn local_approval(
        &self,
        reader: &CanonicalWorkspace,
        plan: &ReviewPlan,
    ) -> Result<LocalApproval, PublicError> {
        let _lock = self.lock()?;
        validate(reader, plan)?;
        let mut journal = self.journal(reader)?;
        self.reconcile_locked(reader, &mut journal)?;
        if journal
            .records
            .iter()
            .any(|r| r.outcome == WriteOutcome::Unknown)
        {
            return Err(PublicError::RecoveryRequired);
        }
        Ok(LocalApproval {
            fingerprint: plan.fingerprint(),
            epoch: journal.epoch,
        })
    }
    /// Journaled mutation without interactive Apply. Rechecks snapshots under lock.
    pub fn apply_auto(
        &self,
        reader: &CanonicalWorkspace,
        plan: ReviewPlan,
    ) -> Result<usize, PublicError> {
        let _lock = self.lock()?;
        let mut journal = self.journal(reader)?;
        self.reconcile_locked(reader, &mut journal)?;
        if journal
            .records
            .iter()
            .any(|r| r.outcome == WriteOutcome::Unknown)
        {
            return Err(PublicError::RecoveryRequired);
        }
        validate(reader, &plan)?;
        let now = reader.unix_seconds()?;
        journal.records.retain(|r| {
            now.saturating_sub(r.created) <= RETAIN_SECONDS
                || matches!(r.outcome, WriteOutcome::Intent | WriteOutcome::Unknown)
        });
        if journal.records.len() + plan.proposals.len() > MAX_RECORDS {
            return Err(PublicError::CapacityExceeded);
        }
        let start = journal.records.len();
        for proposal in &plan.proposals {
            if proposal.capture.as_ref().is_some_and(|id| {
                journal.records.iter().any(|r| {
                    r.proposal.capture.as_ref() == Some(id) && r.outcome == WriteOutcome::Applied
                })
            }) {
                return Err(PublicError::AlreadyProcessed);
            }
            let id = ContentHash::combined(&[
                plan.fingerprint().as_str().as_bytes(),
                now.to_string().as_bytes(),
                journal.records.len().to_string().as_bytes(),
            ]);
            journal.records.push(JournalRecord {
                id,
                created: now,
                proposal: proposal.clone(),
                outcome: WriteOutcome::Unattempted,
            });
        }
        self.save_journal(&journal)?;
        let mut applied = 0;
        let mut owned: Vec<synapse_core::FileSnapshot> = Vec::new();
        for (index, mut proposal) in plan.proposals.into_iter().enumerate() {
            for source in &mut proposal.sources {
                if let Some(own) = owned.iter().find(|own| own.path == source.path) {
                    if snapshot(reader, &source.path)? != *own {
                        return Err(PublicError::Conflict);
                    }
                    *source = own.clone();
                }
            }
            let check = ReviewPlan {
                proposals: vec![proposal.clone()],
                policy: plan.policy.clone(),
                provider: plan.provider.clone(),
            };
            validate(reader, &check)?;
            journal.records[start + index].proposal = proposal.clone();
            journal.records[start + index].outcome = WriteOutcome::Intent;
            self.save_journal(&journal)?;
            let result = apply_one(reader, &proposal);
            journal.records[start + index].outcome = outcome_of(reader, &proposal)?;
            self.save_journal(&journal)?;
            result?;
            if proposal.kind != ProposalKind::Delete {
                let path = proposal.rename_to.as_ref().unwrap_or(&proposal.target.path);
                owned.push(snapshot(reader, path)?);
            }
            applied += 1;
        }
        Ok(applied)
    }
    pub fn apply_reviewed(
        &self,
        reader: &CanonicalWorkspace,
        plan: ReviewPlan,
        approval: LocalApproval,
    ) -> Result<usize, PublicError> {
        if approval.fingerprint != plan.fingerprint() {
            return Err(PublicError::ApprovalRequired);
        }
        let _lock = self.lock()?;
        let journal = self.journal(reader)?;
        if approval.epoch != journal.epoch {
            return Err(PublicError::Conflict);
        }
        drop(_lock);
        self.apply_auto(reader, plan)
    }
}

impl DiskStateStore {
    pub fn revert_plan(
        &self,
        reader: &CanonicalWorkspace,
        id: &str,
        provider: ContentHash,
    ) -> Result<ReviewPlan, PublicError> {
        let records = self.history(reader)?;
        let record = records
            .iter()
            .find(|r| r.id.as_str() == id && r.outcome == WriteOutcome::Applied)
            .ok_or(PublicError::Usage)?;
        if record.proposal.kind == ProposalKind::Setup {
            return Err(PublicError::AccessRefused);
        }
        let instructions = reader.snapshot_control(ControlFile::Instructions)?;
        let proposal = match record.proposal.kind {
            ProposalKind::Delete => {
                let target = snapshot(reader, &record.proposal.target.path)?;
                if target.before.is_some() {
                    return Err(PublicError::Conflict);
                }
                Proposal {
                    kind: ProposalKind::Revert,
                    target,
                    after: record.proposal.target.before.clone().unwrap_or_default(),
                    rename_to: None,
                    sources: vec![instructions],
                    capture: None,
                }
            }
            ProposalKind::Rename => {
                let dest = record
                    .proposal
                    .rename_to
                    .as_ref()
                    .ok_or(PublicError::StateUnavailable)?;
                let current = snapshot(reader, dest)?;
                if current.before.as_deref() != Some(record.proposal.after.as_str()) {
                    return Err(PublicError::Conflict);
                }
                if snapshot(reader, &record.proposal.target.path)?
                    .before
                    .is_some()
                {
                    return Err(PublicError::Conflict);
                }
                Proposal {
                    kind: ProposalKind::Rename,
                    target: current,
                    after: record.proposal.after.clone(),
                    rename_to: Some(record.proposal.target.path.clone()),
                    sources: vec![instructions],
                    capture: None,
                }
            }
            _ => {
                let target = snapshot(reader, &record.proposal.target.path)?;
                if target.before.as_deref() != Some(record.proposal.after.as_str()) {
                    return Err(PublicError::Conflict);
                }
                Proposal {
                    kind: ProposalKind::Revert,
                    target,
                    after: record.proposal.target.before.clone().unwrap_or_default(),
                    rename_to: None,
                    sources: vec![instructions],
                    capture: None,
                }
            }
        };
        Ok(ReviewPlan {
            proposals: vec![proposal],
            policy: synapse_core::policy_fingerprint(reader.access_policy()),
            provider,
        })
    }
    /// Local history clearing revokes grants and index state. Note files and
    /// command-line access configuration are untouched.
    pub fn clear_history(&self, reader: &CanonicalWorkspace) -> Result<(), PublicError> {
        if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
            return Err(PublicError::TtyRequired);
        }
        let _lock = self.lock()?;
        self.revoke_all_locked()?;
        self.clear_index()?;
        let old = self.journal(reader)?;
        let journal = Journal {
            version: 1,
            workspace: reader.workspace_id()?,
            epoch: old
                .epoch
                .checked_add(1)
                .ok_or(PublicError::StateUnavailable)?,
            records: old
                .records
                .into_iter()
                .filter(|record| {
                    matches!(record.outcome, WriteOutcome::Intent | WriteOutcome::Unknown)
                })
                .collect(),
        };
        self.save_journal(&journal)?;
        self.write_state(StateFile::Captures, serde_json::to_string(&serde_json::json!({"kind":"synapse-rust-captures","version":1,"workspace":reader.workspace_id()?,"captures":[]})).map_err(|_| PublicError::StateUnavailable)?.as_bytes())?;
        self.write_state(
            StateFile::Contradictions,
            serde_json::to_string(&serde_json::json!({
                "kind":"synapse-rust-contradictions",
                "version":1,
                "workspace":reader.workspace_id()?,
                "reports":[]
            }))
            .map_err(|_| PublicError::StateUnavailable)?
            .as_bytes(),
        )
    }
}

#[cfg(test)]
#[path = "../tests/support/write_unit.rs"]
mod tests;
