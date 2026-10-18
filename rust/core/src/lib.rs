mod cancellation;
mod contracts;
mod path;

pub use cancellation::Cancellation;
pub use contracts::{PublicError, WorkspaceInfo, WorkspaceReadPort};
pub use path::NotePath;

mod corpus;
pub use corpus::{
    Attention, CorpusError, CorpusPolicy, CorpusReadPort, Document, Limits, Metadata, Scan,
    parse_document,
};

mod model;
pub use model::{
    CONTEXT_TOKENS, MAX_CANDIDATE_PASSAGES, MAX_CONTEXT_TURNS, MAX_PASSAGE_BYTES,
    MAX_QUESTION_BYTES, MAX_RESPONSE_BYTES, MAX_SEARCH_TERMS, MAX_SELECTED_PASSAGES,
    MAX_TERM_BYTES, ModelError, ModelLease, ModelLeasePort, ModelRequest, ModelResponse, ModelTask,
    ModelTransport, OUTPUT_TOKENS, Provider, RemoteConsent, RetrievalDecision,
};

mod runtime;
pub use runtime::{Clock, SignalPort, StateStore};
