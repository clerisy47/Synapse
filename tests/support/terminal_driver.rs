//! Synthetic terminal harness. Never packaged or installed as the product binary.
use std::path::Path;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use synapse_adapters::{NativeSignals, NativeWorkspace, WorkspaceCorpus};
use synapse_application::{
    ChatError, ChatPort, ChatSession, Corpus, SessionFactory, SessionOptions,
};
use synapse_core::{
    Cancellation, Clock, ModelError, ModelLease, ModelLeasePort, ModelRequest, ModelResponse,
    ModelTask, ModelTransport, RetrievalDecision,
};
struct Time;
impl Clock for Time {
    fn milliseconds(&self) -> u64 {
        0
    }
}
struct Guard;
impl ModelLease for Guard {}
struct Lease;
impl ModelLeasePort for Lease {
    fn acquire(&self, _: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError> {
        Ok(Box::new(Guard))
    }
}
struct Script(AtomicUsize);
impl ModelTransport for Script {
    fn complete(
        &self,
        request: &ModelRequest,
        _: &Cancellation,
    ) -> Result<ModelResponse, ModelError> {
        let ModelTask::Retrieve {
            question, passages, ..
        } = request.task()
        else {
            return Err(ModelError::Format);
        };
        assert!(passages.iter().all(|p| !p.contains("EXCLUDED_SENTINEL")));
        if question.contains("delayed") {
            eprintln!("MODEL_STARTED");
            std::thread::sleep(Duration::from_millis(300));
        }
        let call = self.0.fetch_add(1, Ordering::SeqCst);
        let decision = if question.contains("invalid") {
            RetrievalDecision::Supported(vec![999])
        } else if question.contains("unsupported") || passages.is_empty() && call > 0 {
            RetrievalDecision::Insufficient
        } else if passages.is_empty() {
            RetrievalDecision::Search(vec!["Aurora".into()])
        } else {
            RetrievalDecision::Supported(vec![0])
        };
        Ok(ModelResponse::Retrieval(decision))
    }
}
struct Factory;
impl SessionFactory for Factory {
    fn open(&self, root: &str, options: SessionOptions) -> Result<Box<dyn ChatPort>, ChatError> {
        let state = Path::new(root)
            .parent()
            .ok_or(ChatError::Input)?
            .join("test-state");
        let corpus = Corpus::new(
            WorkspaceCorpus::open(Path::new(root), &state)?,
            options.policy,
        );
        Ok(Box::new(ChatSession::new(
            corpus,
            Box::new(Script(AtomicUsize::new(0))),
            Box::new(Lease),
            Time,
            options.provider,
        )))
    }
}
fn main() -> ExitCode {
    ExitCode::from(synapse_terminal::run(
        &NativeWorkspace,
        &Factory,
        &NativeSignals,
    ))
}
