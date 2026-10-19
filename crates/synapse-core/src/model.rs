use crate::{Evidence, PublicError};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[derive(Clone, Default)]
pub struct Cancellation {
    flag: Arc<AtomicBool>,
    budget: Option<Arc<dyn Fn() -> u64 + Send + Sync>>,
}
impl Cancellation {
    pub fn with_budget(mut self, budget: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        self.budget = Some(Arc::new(budget));
        self
    }
    pub fn remaining_millis(&self) -> Option<u64> {
        self.budget.as_ref().map(|budget| budget())
    }
    pub fn cancel(&self) {
        self.flag.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::Acquire) || self.remaining_millis() == Some(0)
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Interactive,
    Background,
}
pub enum ModelJob {
    Health,
    RepairMetadata {
        input: crate::MetadataInput,
    },
    DraftResearch {
        capture: crate::CapturedResearch,
        instructions: crate::FileSnapshot,
    },
    SearchTerms {
        question: String,
    },
    SelectEvidence {
        question: String,
        evidence: Vec<Evidence>,
    },
}
pub enum ModelResult {
    Healthy,
    Metadata(crate::MetadataFields),
    Draft(Option<crate::ResearchDraft>),
    SearchTerms(Vec<String>),
    Selected(Vec<usize>),
    InsufficientEvidence,
}
pub trait ModelService: Send + Sync {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError>;
}
