//! Pure values and narrow authority contracts. No operating-system dependencies.
mod workspace;
pub use workspace::{
    Clock, MAX_DEPTH, MAX_FILES, MAX_INDEXED_NOTES, MAX_NOTE_BYTES, NotePath, NoteReadPort,
    PublicError, WorkspaceIdentity, WorkspaceReadPort,
};

mod corpus;
pub use corpus::{AccessPolicy, Corpus, Evidence, MAX_INDEX_BYTES, verify_evidence};

mod model;
pub use model::{Cancellation, ModelJob, ModelResult, ModelService, Priority};

mod chat;
pub use chat::{
    Answer, AnswerOutcome, ChatSession, MAX_CHAT_TURNS, MAX_EVIDENCE_INPUT_BYTES,
    MAX_RETRIEVAL_CANDIDATES, QueryStats,
};

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

mod contradiction;
mod research;
mod starters;
pub use contradiction::{
    ContradictionAssessment, ContradictionReport, ContradictionSeverity, MAX_CONTRADICTION_REPORTS,
    MAX_CONTRADICTION_SUMMARY,
};
pub use research::{
    DailyDate, DailyRoute, Destination, Instructions, ResearchDraft, ResearchOp, ResearchOpKind,
    capture_research, parse_instructions, research_proposal, research_proposals, setup_preview,
    source_excluded,
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

mod source_blocks;
pub use source_blocks::{
    BlockKind, EvidencePacket, MAX_CANDIDATE_PACKETS, MAX_CANDIDATE_RANGES, MAX_PACKET_RANGES,
    SourceBlock, source_blocks,
};

mod coverage;
pub use coverage::{
    Assessment, MAX_ASSESSMENTS, MAX_LEDGER_RANGES, MAX_MODEL_CALLS, MAX_PROMPT_TOKENS,
    MAX_REQUIREMENTS, OutputProfile, QuestionPlan, Requirement, RequirementHints,
    RequirementSupport, SupportState, WORKFLOW_MILLIS, question_requirements, validate_assessment,
    validate_plan, value_evidence_compatible,
};

mod search_index;
pub use search_index::{IndexHit, IndexTerms, IndexedSource, MemorySearchIndex, SearchIndexPort};

pub use coverage::{
    LOCAL_CONTEXT_TOKENS, MAX_COMPLETION_TOKENS, MAX_OPERATION_PROMPT_TOKENS,
    MAX_SERIALIZED_REQUEST_BYTES, REMOTE_COMPLETION_TOKENS, REMOTE_CONTEXT_TOKENS,
    TOKEN_SAFETY_RESERVE,
};

pub use coverage::{
    AssessmentPurpose, RequirementKind, RequirementRefinement, SupportBasis, identity_refinements,
    refine_question,
};

pub use coverage::{
    ModelBudget, refine_question_with_budget, validate_assessment_with_budget,
    validate_plan_with_budget,
};
