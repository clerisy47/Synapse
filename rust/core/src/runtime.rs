use crate::{Cancellation, ModelError, ModelLeasePort, PublicError};
use std::sync::Arc;
pub trait Clock {
    fn milliseconds(&self) -> u64;
}
pub trait SignalPort {
    fn install(&self, token: Arc<Cancellation>) -> Result<(), PublicError>;
}
/// Only state adapters may provision application state. No note-writing capability.
pub trait StateStore {
    fn model_lease(&self) -> Result<Box<dyn ModelLeasePort>, ModelError>;
}
