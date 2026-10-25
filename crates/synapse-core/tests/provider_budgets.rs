use synapse_core::*;

#[test]
fn provider_budgets_bound_both_profiles_to_thirty_two_calls() {
    assert_eq!(MAX_MODEL_CALLS, 32);
    assert_eq!(MAX_ASSESSMENTS, 30);
    assert_eq!(ModelBudget::Local.context_tokens(), 4096);
    assert_eq!(ModelBudget::Remote.context_tokens(), 32768);
    assert_eq!(ModelBudget::Local.completion_tokens(), 512);
    assert_eq!(ModelBudget::Remote.completion_tokens(), 2048);
    assert_eq!(ModelBudget::Local.workflow_prompt_tokens(), 112640);
    assert_eq!(ModelBudget::Remote.workflow_prompt_tokens(), 980992);
    assert_eq!(
        MAX_PROMPT_TOKENS,
        ModelBudget::Local.workflow_prompt_tokens()
    );
}

#[test]
fn large_remote_plan_is_valid_only_for_remote_and_remains_bounded() {
    let requirements = question_requirements("What is precision?")
        .unwrap_or_else(|e| panic!("synthetic fixture: {e:?}"));
    let mut plan = QuestionPlan {
        hints: requirements
            .iter()
            .map(|r| RequirementHints {
                id: r.id,
                terms: vec!["precision".into()],
            })
            .collect(),
        refinements: identity_refinements(&requirements),
        prompt_tokens: 5000,
        completion_tokens: 100,
    };
    assert!(validate_plan(&requirements, &plan).is_err());
    assert!(validate_plan_with_budget(&requirements, &plan, ModelBudget::Remote).is_ok());
    plan.prompt_tokens = ModelBudget::Remote.operation_prompt_tokens() + 1;
    assert!(validate_plan_with_budget(&requirements, &plan, ModelBudget::Remote).is_err());
    plan.prompt_tokens = 1;
    plan.completion_tokens = ModelBudget::Remote.completion_tokens() + 1;
    assert!(validate_plan_with_budget(&requirements, &plan, ModelBudget::Remote).is_err());
}

#[test]
fn remote_assessment_keeps_usage_and_evidence_validation() {
    let requirements = question_requirements("What is precision?")
        .unwrap_or_else(|e| panic!("synthetic fixture: {e:?}"));
    let evidence = vec![Evidence {
        id: 1,
        path: NotePath::parse("fixture.md").unwrap_or_else(|e| panic!("synthetic fixture: {e:?}")),
        start_line: 6,
        end_line: 6,
        text: "Precision is the fraction of predicted positives that are correct.".into(),
    }];
    let mut assessment = Assessment {
        support: vec![RequirementSupport {
            id: requirements[0].id,
            state: SupportState::Supported,
            basis: SupportBasis::Definition,
            evidence_ids: vec![1],
            value_evidence_id: None,
        }],
        served_ids: vec![1],
        prompt_tokens: 5000,
        completion_tokens: 50,
    };
    assert!(validate_assessment(&requirements, &evidence, &assessment).is_err());
    assert!(
        validate_assessment_with_budget(&requirements, &evidence, &assessment, ModelBudget::Remote)
            .is_ok()
    );
    assessment.support[0].evidence_ids = vec![999];
    assert!(
        validate_assessment_with_budget(&requirements, &evidence, &assessment, ModelBudget::Remote)
            .is_err()
    );
    assessment.support[0].evidence_ids = vec![1];
    assessment.prompt_tokens = ModelBudget::Remote.operation_prompt_tokens() + 1;
    assert!(
        validate_assessment_with_budget(&requirements, &evidence, &assessment, ModelBudget::Remote)
            .is_err()
    );
}

mod support;

struct LateSupport {
    profile: ModelBudget,
    assessments: std::sync::atomic::AtomicUsize,
}
impl ModelService for LateSupport {
    fn budget(&self) -> ModelBudget {
        self.profile
    }
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let usage = if self.profile == ModelBudget::Remote {
            5000
        } else {
            100
        };
        match job {
            ModelJob::PlanQuestion { requirements, .. } => {
                Ok(ModelResult::QuestionPlan(QuestionPlan {
                    hints: requirements
                        .iter()
                        .map(|r| RequirementHints {
                            id: r.id,
                            terms: vec!["precision".into()],
                        })
                        .collect(),
                    refinements: identity_refinements(&requirements),
                    prompt_tokens: usage,
                    completion_tokens: 1,
                }))
            }
            ModelJob::AssessEvidence {
                requirements,
                evidence,
                ..
            } => {
                let count = self
                    .assessments
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                    + 1;
                let first = evidence.first().ok_or(PublicError::InvalidModelOutput)?.id;
                Ok(ModelResult::Assessment(Assessment {
                    support: requirements
                        .iter()
                        .map(|r| RequirementSupport {
                            id: r.id,
                            state: if count == MAX_ASSESSMENTS {
                                SupportState::Supported
                            } else {
                                SupportState::MissingInformation
                            },
                            basis: SupportBasis::Definition,
                            evidence_ids: if count == MAX_ASSESSMENTS {
                                vec![first]
                            } else {
                                vec![]
                            },
                            value_evidence_id: None,
                        })
                        .collect(),
                    served_ids: vec![first],
                    prompt_tokens: usage,
                    completion_tokens: 1,
                }))
            }
            ModelJob::ConfirmCoverage {
                requirements,
                evidence,
                ..
            } => Ok(ModelResult::Assessment(Assessment {
                support: requirements
                    .iter()
                    .map(|r| RequirementSupport {
                        id: r.id,
                        state: SupportState::Supported,
                        basis: SupportBasis::Definition,
                        evidence_ids: evidence.iter().map(|e| e.id).collect(),
                        value_evidence_id: None,
                    })
                    .collect(),
                served_ids: evidence.iter().map(|e| e.id).collect(),
                prompt_tokens: usage,
                completion_tokens: 1,
            })),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn both_profiles_can_use_thirty_two_calls_with_final_confirmation_reserved() {
    let notes: Vec<_> = (0..48).map(|i| (format!("precision-{i}.md"), format!("# Precision trial {i}\nPrecision is the fraction of predicted positives that are correct in trial {i}."))).collect();
    let borrowed: Vec<_> = notes
        .iter()
        .map(|(p, b)| (p.as_str(), b.as_str()))
        .collect();
    let workspace = support::Workspace::new(&borrowed);
    for profile in [ModelBudget::Local, ModelBudget::Remote] {
        let policy = AccessPolicy::default();
        let mut chat = ChatSession::new(&workspace, policy.clone())
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        let model = LateSupport {
            profile,
            assessments: std::sync::atomic::AtomicUsize::new(0),
        };
        let answer = chat
            .ask(
                "What is precision?",
                &workspace,
                &policy,
                &model,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| {
                panic!(
                    "fixture: {e:?}, profile={profile:?}, assessments={}, calls={}",
                    model.assessments.load(std::sync::atomic::Ordering::SeqCst),
                    chat.stats().calls
                )
            });
        assert_eq!(answer.outcome, AnswerOutcome::Answered);
        assert_eq!(chat.stats().calls, MAX_MODEL_CALLS);
        assert_eq!(
            model.assessments.load(std::sync::atomic::Ordering::SeqCst),
            MAX_ASSESSMENTS
        );
        assert_eq!(
            chat.stats().prompt_tokens,
            32 * if profile == ModelBudget::Remote {
                5000
            } else {
                100
            }
        );
    }
}
