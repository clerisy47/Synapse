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
    pub fn bounded(&self, millis: u64, now: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        let parent = self.clone();
        let start = now();
        Self {
            flag: self.flag.clone(),
            budget: Some(Arc::new(move || {
                millis
                    .saturating_sub(now().saturating_sub(start))
                    .min(parent.remaining_millis().unwrap_or(u64::MAX))
            })),
        }
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
    PlanQuestion {
        question: String,
        requirements: Vec<crate::Requirement>,
        evidence: Vec<Evidence>,
    },
    AssessEvidence {
        purpose: crate::AssessmentPurpose,
        question: String,
        requirements: Vec<crate::Requirement>,
        evidence: Vec<Evidence>,
    },
    ConfirmCoverage {
        question: String,
        requirements: Vec<crate::Requirement>,
        evidence: Vec<Evidence>,
    },
    Health,
    RepairMetadata {
        input: crate::MetadataInput,
    },
    DraftResearch {
        capture: crate::CapturedResearch,
        instructions: crate::FileSnapshot,
        inventory: Vec<(String, crate::NotePath)>,
    },
    AssessContradiction {
        capture: crate::CapturedResearch,
        destinations: Vec<(crate::NotePath, String)>,
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
    QuestionPlan(crate::QuestionPlan),
    Assessment(crate::Assessment),
    Healthy,
    Metadata(crate::MetadataFields),
    Draft(Option<crate::ResearchDraft>),
    Contradiction(crate::ContradictionAssessment),
    SearchTerms(Vec<String>),
    Selected(Vec<usize>),
    InsufficientEvidence,
}
pub trait ModelService: Send + Sync {
    fn budget(&self) -> crate::ModelBudget {
        crate::ModelBudget::Local
    }
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError>;
}
