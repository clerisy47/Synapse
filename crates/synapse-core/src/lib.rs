//! Pure values and narrow authority contracts. No operating-system dependencies.
mod workspace;
pub use workspace::{
    Clock, MAX_DEPTH, MAX_FILES, MAX_NOTE_BYTES, NotePath, NoteReadPort, PublicError,
    WorkspaceIdentity, WorkspaceReadPort,
};

mod corpus;
pub use corpus::{AccessPolicy, Corpus, Evidence, MAX_INDEX_BYTES, verify_evidence};

mod model;
pub use model::{Cancellation, ModelJob, ModelResult, ModelService, Priority};

mod chat;
pub use chat::{Answer, ChatSession, MAX_CHAT_TURNS};

mod bounded_yaml;

mod research_types;
pub use research_types::{
    CapturedResearch, ContentHash, ControlReadPort, MAX_CAPTURE_BYTES, MAX_CAPTURES,
    MAX_CONTROL_BYTES, MAX_INSTRUCTION_BYTES, StateStore, hex_encode,
};

mod review;
pub use review::{
    ControlFile, FileSnapshot, ParentSnapshot, Proposal, ProposalKind, ProposalReadPort,
    ReviewPlan, policy_fingerprint, proposal_access,
};

mod research;
mod starters;
pub use research::{
    DailyDate, DailyRoute, Destination, Instructions, ResearchDraft, capture_research,
    parse_instructions, research_proposal, setup_preview, source_excluded,
};

mod metadata;
pub use metadata::{
    MetadataFields, MetadataInput, MissingFields, metadata_input, metadata_proposal,
    ordinary_content, plain_model_text,
};

pub fn setup_instruction_bytes() -> &'static str {
    starters::INSTRUCTIONS_STARTER
}
pub fn setup_research_bytes() -> &'static str {
    starters::RESEARCH_STARTER
}
