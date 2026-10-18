use crate::state::NativeStateStore;
use crate::{ProviderTransport, WorkspaceCorpus};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use synapse_application::{
    ChatError, ChatPort, ChatSession, Corpus, SessionFactory, SessionOptions,
};
use synapse_core::{
    Cancellation, Clock, ModelError, ModelLease, ModelLeasePort, PublicError, SignalPort,
    StateStore,
};

pub struct NativeSignals;
impl SignalPort for NativeSignals {
    fn install(&self, token: Arc<Cancellation>) -> Result<(), PublicError> {
        ctrlc::set_handler(move || token.cancel()).map_err(|_| PublicError::Runtime)
    }
}
pub struct NativeClock(Instant);
impl NativeClock {
    pub fn start() -> Self {
        Self(Instant::now())
    }
}
impl Clock for NativeClock {
    fn milliseconds(&self) -> u64 {
        self.0.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
}
pub struct NativeSessions;
impl SessionFactory for NativeSessions {
    fn open(
        &self,
        canonical_root: &str,
        options: SessionOptions,
    ) -> Result<Box<dyn ChatPort>, ChatError> {
        let state = NativeStateStore::new(Path::new(canonical_root))?;
        let reader = WorkspaceCorpus::open(Path::new(canonical_root), state.path())?;
        if reader.canonical_root() != Path::new(canonical_root) {
            return Err(synapse_core::CorpusError::Stale.into());
        }
        let key = if options.provider.remote_model().is_some() {
            Some(std::env::var("OPENROUTER_API_KEY").map_err(|_| ModelError::Configuration)?)
        } else {
            None
        };
        let transport = ProviderTransport::new(key)?;
        Ok(Box::new(ChatSession::new(
            Corpus::new(reader, options.policy),
            Box::new(transport),
            Box::new(LazyLease(state)),
            NativeClock::start(),
            options.provider,
        )))
    }
}
struct LazyLease(NativeStateStore);
impl ModelLeasePort for LazyLease {
    fn acquire(&self, cancel: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError> {
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        self.0.model_lease()?.acquire(cancel)
    }
}
