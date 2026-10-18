use crate::{Evidence, PublicError};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    Interactive,
    Background,
}
pub enum ModelJob {
    Health,
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
