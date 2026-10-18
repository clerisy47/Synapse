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
    CONTEXT_TOKENS, MAX_RESPONSE_BYTES, ModelError, ModelLease, ModelLeasePort, ModelRequest,
    ModelResponse, ModelTransport, OUTPUT_TOKENS, Provider, RemoteConsent,
};
