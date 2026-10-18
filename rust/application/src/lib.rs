use synapse_core::{PublicError, WorkspaceInfo, WorkspaceReadPort};

/// Validate an explicit root through its narrow read-only port.
pub fn open_workspace(
    reader: &dyn WorkspaceReadPort,
    selected: &str,
) -> Result<WorkspaceInfo, PublicError> {
    if selected.is_empty() {
        return Err(PublicError::Usage);
    }
    reader.validate_root(selected)
}

mod corpus;
pub use corpus::{Corpus, EvidenceId, Hit, Passage};

mod jobs;
pub use jobs::{JobPriority, JobQueue, MAX_PENDING_JOBS, QUEUE_TIMEOUT};

mod chat;
pub use chat::{Answer, ChatError, ChatPort, ChatSession, SessionFactory, SessionOptions};
