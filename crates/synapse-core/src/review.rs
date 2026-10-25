use crate::{AccessPolicy, ContentHash, ControlReadPort, NotePath, NoteReadPort, PublicError};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy)]
pub enum ControlFile {
    Instructions,
    Research,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParentSnapshot {
    pub path: String,
    pub identity: Option<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileSnapshot {
    pub workspace: ContentHash,
    pub path: NotePath,
    pub before: Option<String>,
    pub identity: Option<String>,
    pub mode: Option<u32>,
    pub owner: Option<u32>,
    pub links: Option<u64>,
    pub parents: Vec<ParentSnapshot>,
}
impl FileSnapshot {
    pub fn fingerprint(&self) -> ContentHash {
        let mut parts = vec![
            self.workspace.as_str().as_bytes().to_vec(),
            self.path.as_str().as_bytes().to_vec(),
            vec![u8::from(self.before.is_some())],
            self.before.as_deref().unwrap_or("").as_bytes().to_vec(),
            self.identity.as_deref().unwrap_or("").as_bytes().to_vec(),
            format!("{:?}:{:?}:{:?}", self.mode, self.owner, self.links).into_bytes(),
        ];
        for parent in &self.parents {
            parts.push(parent.path.as_bytes().to_vec());
            parts.push(vec![u8::from(parent.identity.is_some())]);
            parts.push(parent.identity.as_deref().unwrap_or("").as_bytes().to_vec());
        }
        ContentHash::combined(&parts.iter().map(Vec::as_slice).collect::<Vec<_>>())
    }
}
pub trait ProposalReadPort: NoteReadPort + ControlReadPort {
    fn access_policy(&self) -> &AccessPolicy;
    fn workspace_id(&self) -> Result<ContentHash, PublicError>;
    fn snapshot_note(&self, path: &NotePath) -> Result<FileSnapshot, PublicError>;
    fn snapshot_control(&self, control: ControlFile) -> Result<FileSnapshot, PublicError>;
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalKind {
    Setup,
    Metadata,
    Research,
    Revert,
    Delete,
    Rename,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub kind: ProposalKind,
    pub target: FileSnapshot,
    pub after: String,
    #[serde(default)]
    pub rename_to: Option<NotePath>,
    pub sources: Vec<FileSnapshot>,
    pub capture: Option<ContentHash>,
}
pub struct ReviewPlan {
    pub proposals: Vec<Proposal>,
    pub policy: ContentHash,
    pub provider: ContentHash,
}
impl ReviewPlan {
    pub fn fingerprint(&self) -> ContentHash {
        let mut parts = vec![
            self.policy.as_str().as_bytes().to_vec(),
            self.provider.as_str().as_bytes().to_vec(),
        ];
        for proposal in &self.proposals {
            parts.push(vec![match proposal.kind {
                ProposalKind::Setup => 0,
                ProposalKind::Metadata => 1,
                ProposalKind::Research => 2,
                ProposalKind::Revert => 3,
                ProposalKind::Delete => 4,
                ProposalKind::Rename => 5,
            }]);
            parts.push(
                proposal
                    .capture
                    .as_ref()
                    .map(|id| id.as_str())
                    .unwrap_or("")
                    .as_bytes()
                    .to_vec(),
            );
            parts.push(proposal.target.fingerprint().as_str().as_bytes().to_vec());
            parts.push(proposal.after.as_bytes().to_vec());
            parts.push(
                proposal
                    .rename_to
                    .as_ref()
                    .map(|path| path.as_str())
                    .unwrap_or("")
                    .as_bytes()
                    .to_vec(),
            );
            for source in &proposal.sources {
                parts.push(source.fingerprint().as_str().as_bytes().to_vec());
            }
        }
        ContentHash::combined(&parts.iter().map(Vec::as_slice).collect::<Vec<_>>())
    }
}
pub fn policy_fingerprint(policy: &AccessPolicy) -> ContentHash {
    let mut parts = vec![
        policy.instructions.as_str().as_bytes(),
        policy.research.as_str().as_bytes(),
    ];
    let folder_count = policy.folders.len().to_string();
    let tag_count = policy.tags.len().to_string();
    parts.push(folder_count.as_bytes());
    for folder in &policy.folders {
        parts.push(folder.as_bytes());
    }
    parts.push(tag_count.as_bytes());
    for tag in &policy.tags {
        parts.push(tag.as_bytes());
    }
    ContentHash::combined(&parts)
}

/// Check mutation authority before journaled apply. Control files are never
/// delete/rename targets. Retained history does not exempt a revert from the
/// current control/tag exclusion policy.
pub fn proposal_access(policy: &AccessPolicy, proposal: &Proposal) -> bool {
    if proposal.kind == ProposalKind::Setup {
        return proposal.target.before.is_none()
            && proposal.rename_to.is_none()
            && ((proposal.target.path == policy.instructions
                && proposal.after == crate::starters::INSTRUCTIONS_STARTER)
                || (proposal.target.path == policy.research
                    && proposal.after == crate::starters::RESEARCH_STARTER));
    }
    let control = proposal.target.path == policy.instructions
        || proposal.target.path == policy.research
        || proposal
            .rename_to
            .as_ref()
            .is_some_and(|path| *path == policy.instructions || *path == policy.research);
    if control {
        return false;
    }
    match proposal.kind {
        ProposalKind::Delete => {
            proposal.rename_to.is_none()
                && proposal.after.is_empty()
                && proposal.target.before.is_some()
                && policy.permits_path(&proposal.target.path)
                && !crate::source_excluded(proposal.target.before.as_deref().unwrap_or(""), policy)
        }
        ProposalKind::Rename => {
            let Some(dest) = proposal.rename_to.as_ref() else {
                return false;
            };
            *dest != proposal.target.path
                && proposal.target.before.is_some()
                && proposal.after == proposal.target.before.clone().unwrap_or_default()
                && policy.permits_path(&proposal.target.path)
                && policy.permits_path(dest)
                && !crate::source_excluded(proposal.target.before.as_deref().unwrap_or(""), policy)
        }
        _ => {
            proposal.rename_to.is_none()
                && policy.permits_path(&proposal.target.path)
                && !crate::source_excluded(proposal.target.before.as_deref().unwrap_or(""), policy)
                && !crate::source_excluded(&proposal.after, policy)
        }
    }
}
