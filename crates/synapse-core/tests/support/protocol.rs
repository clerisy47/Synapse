//! Explicit adapter for pre-evidence-first scripted selectors. This preserves
//! their chosen IDs/failure hooks while exercising the new production workflow.
use synapse_core::*;
pub fn adapt(
    model: &dyn ModelService,
    job: ModelJob,
    priority: Priority,
    cancel: &Cancellation,
) -> Result<ModelJob, Result<ModelResult, PublicError>> {
    match job {
        ModelJob::PlanQuestion {
            question,
            requirements,
            ..
        } => {
            let terms = match model.execute(ModelJob::SearchTerms { question }, priority, cancel) {
                Ok(ModelResult::SearchTerms(terms)) if !terms.is_empty() => terms,
                Err(error) => return Err(Err(error)),
                _ => return Err(Err(PublicError::InvalidModelOutput)),
            };
            Err(Ok(ModelResult::QuestionPlan(QuestionPlan {
                refinements: identity_refinements(&requirements),
                hints: requirements
                    .iter()
                    .map(|r| RequirementHints {
                        id: r.id,
                        terms: terms.clone(),
                    })
                    .collect(),
                prompt_tokens: 1,
                completion_tokens: 1,
            })))
        }
        ModelJob::AssessEvidence {
            question,
            requirements,
            evidence,
            ..
        }
        | ModelJob::ConfirmCoverage {
            question,
            requirements,
            evidence,
        } => {
            let result = model.execute(
                ModelJob::SelectEvidence {
                    question,
                    evidence: evidence.clone(),
                },
                priority,
                cancel,
            );
            let ids = match result {
                Ok(ModelResult::Selected(ids)) => ids,
                Ok(ModelResult::InsufficientEvidence) => Vec::new(),
                Err(error) => return Err(Err(error)),
                _ => return Err(Err(PublicError::InvalidModelOutput)),
            };
            if ids
                .iter()
                .enumerate()
                .any(|(i, id)| !evidence.iter().any(|e| e.id == *id) || ids[..i].contains(id))
            {
                return Err(Err(PublicError::InvalidModelOutput));
            }
            Err(Ok(ModelResult::Assessment(Assessment {
                support: requirements
                    .iter()
                    .map(|r| {
                        let primary = if r.kind == synapse_core::RequirementKind::Value {
                            ids.iter()
                                .filter_map(|id| evidence.iter().find(|e| e.id == *id))
                                .find(|e| synapse_core::value_evidence_compatible(r, e))
                                .map(|e| e.id)
                        } else {
                            None
                        };
                        let complete = !ids.is_empty()
                            && (r.kind != synapse_core::RequirementKind::Value
                                || primary.is_some());
                        RequirementSupport {
                            value_evidence_id: primary,
                            basis: SupportBasis::Recorded,
                            id: r.id,
                            state: if complete {
                                SupportState::Supported
                            } else {
                                SupportState::MissingInformation
                            },
                            evidence_ids: if complete { ids.clone() } else { vec![] },
                        }
                    })
                    .collect(),
                served_ids: evidence.iter().map(|e| e.id).collect(),
                prompt_tokens: 1,
                completion_tokens: 1,
            })))
        }
        job => Ok(job),
    }
}
