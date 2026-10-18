//! Pure values and narrow authority contracts. No operating-system dependencies.
mod workspace;
pub use workspace::{
    MAX_DEPTH, MAX_FILES, MAX_NOTE_BYTES, NotePath, NoteReadPort, PublicError, WorkspaceIdentity,
    WorkspaceReadPort,
};

mod corpus;
pub use corpus::{AccessPolicy, Corpus, Evidence, MAX_INDEX_BYTES, verify_evidence};

mod model;
pub use model::{Cancellation, ModelJob, ModelResult, ModelService, Priority};
