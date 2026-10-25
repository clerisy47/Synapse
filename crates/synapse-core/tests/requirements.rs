#[path = "support/protocol.rs"]
mod protocol;
mod support;
use synapse_core::*;
fn requirement() -> Vec<Requirement> {
    question_requirements("What is the duration and what is the mitigation?")
        .unwrap_or_else(|e| panic!("{e:?}"))
}
fn source() -> Evidence {
    Evidence {
        id: 1,
        path: NotePath::parse("note.md").unwrap_or_else(|e| panic!("{e:?}")),
        start_line: 6,
        end_line: 6,
        text: "Duration was 24 minutes; concurrency was reduced to 4.".into(),
    }
}
fn assessment() -> Assessment {
    Assessment {
        support: requirement()
            .iter()
            .map(|r| RequirementSupport {
                value_evidence_id: (r.kind == RequirementKind::Value).then_some(1),
                basis: SupportBasis::Recorded,
                id: r.id,
                state: SupportState::Supported,
                evidence_ids: vec![1],
            })
            .collect(),
        served_ids: vec![1],
        prompt_tokens: 123,
        completion_tokens: 1,
    }
}
#[test]
fn explicit_clauses_cannot_be_dropped_by_planner() {
    let req = requirement();
    assert_eq!(req.len(), 2);
    let mut plan = QuestionPlan {
        refinements: identity_refinements(&req),
        hints: vec![
            RequirementHints {
                id: 1,
                terms: vec![],
            },
            RequirementHints {
                id: 2,
                terms: vec!["concurrency".into()],
            },
        ],
        prompt_tokens: 50,
        completion_tokens: 1,
    };
    assert!(validate_plan(&req, &plan).is_ok());
    plan.hints.pop();
    assert!(validate_plan(&req, &plan).is_err());
    plan.hints.push(RequirementHints {
        id: 1,
        terms: vec![],
    });
    assert!(validate_plan(&req, &plan).is_err());
    assert!(question_requirements(&["part"; 9].join(" and ")).is_err());
}
#[test]
fn strict_assessments_reject_unknown_duplicate_omitted_and_inconsistent_ids() {
    let req = requirement();
    let ev = vec![source()];
    assert!(validate_assessment(&req, &ev, &assessment()).is_ok());
    let mut a = assessment();
    a.support[1].id = 1;
    assert!(validate_assessment(&req, &ev, &a).is_err());
    let mut a = assessment();
    a.support.pop();
    assert!(validate_assessment(&req, &ev, &a).is_err());
    let mut a = assessment();
    a.served_ids = vec![99];
    assert!(validate_assessment(&req, &ev, &a).is_err());
    let mut a = assessment();
    a.support[0].evidence_ids = vec![1, 1];
    assert!(validate_assessment(&req, &ev, &a).is_err());
    for state in [
        SupportState::MissingInformation,
        SupportState::Unrelated,
        SupportState::Conflicting,
    ] {
        let mut a = assessment();
        a.support[0].state = state;
        assert!(validate_assessment(&req, &ev, &a).is_err());
    }
    let mut a = assessment();
    a.support[0].state = SupportState::SupportedNegative;
    assert!(validate_assessment(&req, &ev, &a).is_ok());
}
struct Incomplete(std::sync::Mutex<Vec<&'static str>>);
impl ModelService for Incomplete {
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        match job {
            ModelJob::PlanQuestion { requirements, .. } => {
                self.0
                    .lock()
                    .map_err(|_| PublicError::ResourceLimit)?
                    .push("plan");
                Ok(ModelResult::QuestionPlan(QuestionPlan {
                    refinements: identity_refinements(&requirements),
                    hints: requirements
                        .iter()
                        .map(|r| RequirementHints {
                            id: r.id,
                            terms: Vec::new(),
                        })
                        .collect(),
                    prompt_tokens: 1,
                    completion_tokens: 1,
                }))
            }
            ModelJob::AssessEvidence {
                requirements,
                evidence,
                ..
            } => {
                self.0
                    .lock()
                    .map_err(|_| PublicError::ResourceLimit)?
                    .push("assess");
                Ok(ModelResult::Assessment(Assessment {
                    support: requirements
                        .iter()
                        .enumerate()
                        .map(|(i, r)| RequirementSupport {
                            value_evidence_id: (i == 0 && r.kind == RequirementKind::Value)
                                .then_some(evidence[0].id),
                            basis: SupportBasis::Recorded,
                            id: r.id,
                            state: if i == 0 {
                                SupportState::Supported
                            } else {
                                SupportState::MissingInformation
                            },
                            evidence_ids: if i == 0 { vec![evidence[0].id] } else { vec![] },
                        })
                        .collect(),
                    served_ids: evidence.iter().map(|e| e.id).collect(),
                    prompt_tokens: 1,
                    completion_tokens: 1,
                }))
            }
            ModelJob::ConfirmCoverage { .. } => {
                panic!("incomplete output must never be confirmed")
            }
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}
#[test]
fn partial_requirement_never_becomes_an_answer() {
    let reader =
        support::Workspace::new(&[("note.md", "# Incident\nIncident duration was 24 minutes.")]);
    let model = Incomplete(std::sync::Mutex::new(Vec::new()));
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "What is the incident duration and what is the mitigation?",
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(!answer.sufficient());
    assert!(answer.sources.is_empty());
    assert!(model.0.lock().unwrap_or_else(|e| panic!("{e:?}")).len() <= 7);
}
#[test]
fn memory_index_reconciles_without_reparsing_unchanged_notes() {
    let mut reader =
        support::Workspace::new(&[("note.md", "# Trial\nThe trial measured zero failures.")]);
    let policy = AccessPolicy::default();
    let index = std::sync::Arc::new(MemorySearchIndex::default());
    let mut corpus = Corpus::build_with_index(&reader, policy.clone(), Some(index))
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
    corpus
        .refresh(&reader, policy.clone())
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(corpus.reconciliation_counts(), (0, 1));
    reader.notes[0].1 = reader.notes[0].1.replace("zero", "four");
    corpus
        .refresh(&reader, policy.clone())
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(corpus.reconciliation_counts(), (1, 0));
}

struct RejectFinal;
impl ModelService for RejectFinal {
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        match job {
            ModelJob::PlanQuestion { requirements, .. } => {
                Ok(ModelResult::QuestionPlan(QuestionPlan {
                    refinements: identity_refinements(&requirements),
                    hints: requirements
                        .iter()
                        .map(|r| RequirementHints {
                            id: r.id,
                            terms: Vec::new(),
                        })
                        .collect(),
                    prompt_tokens: 10,
                    completion_tokens: 1,
                }))
            }
            ModelJob::AssessEvidence {
                requirements,
                evidence,
                ..
            } => Ok(ModelResult::Assessment(Assessment {
                support: requirements
                    .iter()
                    .map(|r| RequirementSupport {
                        value_evidence_id: (r.kind == RequirementKind::Value)
                            .then(|| {
                                evidence
                                    .iter()
                                    .find(|e| value_evidence_compatible(r, e))
                                    .map(|e| e.id)
                            })
                            .flatten(),
                        basis: SupportBasis::Recorded,
                        id: r.id,
                        state: SupportState::Supported,
                        evidence_ids: evidence.iter().map(|e| e.id).collect(),
                    })
                    .collect(),
                served_ids: evidence.iter().map(|e| e.id).collect(),
                prompt_tokens: 10,
                completion_tokens: 1,
            })),
            ModelJob::ConfirmCoverage {
                requirements,
                evidence,
                ..
            } => Ok(ModelResult::Assessment(Assessment {
                support: requirements
                    .iter()
                    .map(|r| RequirementSupport {
                        value_evidence_id: None,
                        basis: SupportBasis::Recorded,
                        id: r.id,
                        state: SupportState::MissingInformation,
                        evidence_ids: vec![],
                    })
                    .collect(),
                served_ids: evidence.iter().map(|e| e.id).collect(),
                prompt_tokens: 10,
                completion_tokens: 1,
            })),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}
#[test]
fn final_confirmation_can_refuse_a_nonempty_authentic_union() {
    let reader = support::Workspace::new(&[("note.md", "# Battery\nBattery lifetime is 9 hours.")]);
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "What is the battery lifetime?",
            &reader,
            &AccessPolicy::default(),
            &RejectFinal,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(!answer.sufficient());
    assert!(answer.sources.is_empty());
}
#[test]
fn malformed_prompt_usage_is_an_error_before_budget_overflow() {
    let requirements =
        question_requirements("What is the lifetime?").unwrap_or_else(|e| panic!("{e:?}"));
    let mut plan = QuestionPlan {
        refinements: identity_refinements(&requirements),
        hints: vec![RequirementHints {
            id: 1,
            terms: Vec::new(),
        }],
        prompt_tokens: u64::MAX,
        completion_tokens: 1,
    };
    let requirements =
        question_requirements("What is the lifetime?").unwrap_or_else(|e| panic!("{e:?}"));
    assert!(validate_plan(&requirements, &plan).is_err());
    plan.prompt_tokens = 3520;
    assert!(validate_plan(&requirements, &plan).is_ok());
}

struct Complete;
impl ModelService for Complete {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let job = match protocol::adapt(self, job, priority, cancel) {
            Ok(job) => job,
            Err(result) => return result,
        };
        match job {
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            ModelJob::SelectEvidence { evidence, .. } => Ok(ModelResult::Selected(
                evidence.iter().map(|e| e.id).collect(),
            )),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}
#[test]
fn mcp_profile_retains_late_facts_and_limitations_as_complete_ranges() {
    let body = format!(
        "# Beacon report\n\n{}\n\nBeacon duration was 24 minutes.\n\nThe Beacon limitation is a single observational trial.",
        "Beacon background context. ".repeat(36)
    );
    let reader = support::Workspace::new(&[("report.md", &body)]);
    let policy = AccessPolicy::default();
    let mut chat = ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask_with_profile(
            "What was the Beacon duration and what are the limitations?",
            &reader,
            &policy,
            &Complete,
            &Cancellation::default(),
            OutputProfile::MCP,
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(answer.sufficient());
    assert!(answer.sources.len() <= 12);
    assert!(
        answer
            .sources
            .iter()
            .all(|e| e.text.chars().count() <= 600 && verify_evidence(&reader, &policy, e))
    );
    assert!(answer.sources.iter().any(|e| e.text.contains("24 minutes")));
    assert!(
        answer
            .sources
            .iter()
            .any(|e| e.text.contains("single observational trial"))
    );
}

#[test]
fn frozen_holdout_retrieval_is_separate_from_model_judgment() {
    let bytes = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/evidence-holdouts-v1.json"),
    )
    .unwrap_or_else(|e| panic!("{e:?}"));
    let fixture: serde_json::Value =
        serde_json::from_str(&bytes).unwrap_or_else(|e| panic!("{e:?}"));
    let cases = fixture["cases"]
        .as_array()
        .unwrap_or_else(|| panic!("cases"));
    assert_eq!(cases.len(), 24);
    for case in cases {
        let note_values = case["notes"].as_object().unwrap_or_else(|| panic!("notes"));
        let notes = note_values
            .iter()
            .map(|(path, body)| {
                (
                    path.as_str(),
                    body.as_str().unwrap_or_else(|| panic!("body")),
                )
            })
            .collect::<Vec<_>>();
        let reader = support::Workspace::new(&notes);
        let policy = AccessPolicy::default();
        let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
        let question = case["question"]
            .as_str()
            .unwrap_or_else(|| panic!("question"));
        let packets = corpus
            .query_packets(question, &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"));
        let ranges = corpus
            .resolve_packets(&packets, &reader, &policy)
            .unwrap_or_else(|e| panic!("{e:?}"));
        for requirement in case["required"]
            .as_array()
            .unwrap_or_else(|| panic!("requirements"))
        {
            let fact = requirement[0].as_str().unwrap_or_else(|| panic!("fact"));
            assert!(
                ranges.iter().any(|e| e.text.contains(fact)),
                "{} missing {fact}",
                case["id"]
            );
        }
        assert!(ranges.iter().all(|e| verify_evidence(&reader, &policy, e)));
    }
}

#[test]
fn refinement_cannot_weaken_a_requested_value_into_an_absence_fact() {
    let req = question_requirements("What is the measured battery lifetime?")
        .unwrap_or_else(|e| panic!("{e:?}"));
    let mut plan = QuestionPlan {
        refinements: identity_refinements(&req),
        hints: vec![RequirementHints {
            id: 1,
            terms: vec![],
        }],
        prompt_tokens: 50,
        completion_tokens: 1,
    };
    assert!(validate_plan(&req, &plan).is_ok());
    plan.refinements[0].kind = RequirementKind::Existence;
    assert!(validate_plan(&req, &plan).is_err());
    let mut value = Assessment {
        support: vec![RequirementSupport {
            value_evidence_id: Some(1),
            id: 1,
            state: SupportState::SupportedNegative,
            basis: SupportBasis::Absence,
            evidence_ids: vec![1],
        }],
        served_ids: vec![1],
        prompt_tokens: 123,
        completion_tokens: 1,
    };
    assert!(validate_assessment(&req, &[source()], &value).is_err());
    value.support[0].basis = SupportBasis::Recorded;
    assert!(validate_assessment(&req, &[source()], &value).is_ok());
}

struct NoisySupport {
    stages: std::sync::Mutex<Vec<&'static str>>,
    cancel_compaction: bool,
    omit_final_reference: bool,
    drop_requested_attribute: bool,
}
impl ModelService for NoisySupport {
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let (requirements, evidence, stage) = match job {
            ModelJob::PlanQuestion {
                requirements,
                evidence,
                ..
            } => {
                assert!(
                    evidence.is_empty(),
                    "retrieved answers must not become planning obligations"
                );
                self.stages
                    .lock()
                    .map_err(|_| PublicError::ResourceLimit)?
                    .push("plan");
                return Ok(ModelResult::QuestionPlan(QuestionPlan {
                    refinements: identity_refinements(&requirements),
                    hints: requirements
                        .iter()
                        .map(|r| RequirementHints {
                            id: r.id,
                            terms: vec![],
                        })
                        .collect(),
                    prompt_tokens: 1,
                    completion_tokens: 1,
                }));
            }
            ModelJob::AssessEvidence {
                purpose,
                requirements,
                evidence,
                ..
            } => (
                requirements,
                evidence,
                if purpose == AssessmentPurpose::Compact {
                    "compact"
                } else {
                    "collect"
                },
            ),
            ModelJob::ConfirmCoverage {
                requirements,
                evidence,
                ..
            } => (requirements, evidence, "confirm"),
            _ => return Err(PublicError::InvalidModelOutput),
        };
        self.stages
            .lock()
            .map_err(|_| PublicError::ResourceLimit)?
            .push(stage);
        if stage == "collect" {
            assert!(evidence.iter().any(|e| e.path.as_str() == "review.md"));
        }
        if stage == "confirm" {
            assert!(!evidence.iter().any(|e| e.path.as_str() == "review.md"));
        }
        if stage == "compact" && self.cancel_compaction {
            cancel.cancel();
        }
        let mut selected = evidence
            .iter()
            .filter(|e| stage != "compact" || e.path.as_str() != "review.md")
            .map(|e| e.id)
            .collect::<Vec<_>>();
        if matches!(stage, "collect" | "compact") && self.drop_requested_attribute {
            selected.truncate(1);
        }
        if stage == "confirm" && self.omit_final_reference {
            selected.truncate(1);
        }
        Ok(ModelResult::Assessment(Assessment {
            support: requirements
                .iter()
                .map(|r| RequirementSupport {
                    value_evidence_id: None,
                    id: r.id,
                    state: SupportState::Supported,
                    basis: SupportBasis::Recorded,
                    evidence_ids: selected.clone(),
                })
                .collect(),
            served_ids: evidence.iter().map(|e| e.id).collect(),
            prompt_tokens: 1,
            completion_tokens: 1,
        }))
    }
}
fn noisy_fixture() -> support::Workspace {
    support::Workspace::new(&[
        (
            "consumption.md",
            "# Reactor consumption\nThe reactor consumes 42 units.",
        ),
        (
            "scope.md",
            "# Reactor limits\nThe reactor record covers a single fixture.",
        ),
        (
            "review.md",
            "# Reactor review\nThe reactor review is scheduled next month.",
        ),
    ])
}
#[test]
fn compact_support_is_confirmed_as_the_actual_output_within_eight_calls() {
    let reader = noisy_fixture();
    let model = NoisySupport {
        stages: std::sync::Mutex::new(vec![]),
        cancel_compaction: false,
        omit_final_reference: false,
        drop_requested_attribute: false,
    };
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "What is the reactor consumption and what limits apply?",
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(answer.sufficient());
    assert_eq!(answer.sources.len(), 2);
    assert!(
        answer
            .sources
            .iter()
            .all(|e| e.path.as_str() != "review.md")
    );
    assert_eq!(
        *model.stages.lock().unwrap_or_else(|e| panic!("{e:?}")),
        vec!["plan", "collect", "compact", "confirm"]
    );
    assert_eq!(chat.stats().calls, 4);
}
#[test]
fn cancellation_during_compaction_prevents_confirmation_and_output() {
    let reader = noisy_fixture();
    let model = NoisySupport {
        stages: std::sync::Mutex::new(vec![]),
        cancel_compaction: true,
        omit_final_reference: false,
        drop_requested_attribute: false,
    };
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat.ask(
        "What is the reactor consumption and what limits apply?",
        &reader,
        &AccessPolicy::default(),
        &model,
        &Cancellation::default(),
    );
    assert!(matches!(answer, Err(PublicError::Cancelled)));
    assert!(
        !model
            .stages
            .lock()
            .unwrap_or_else(|e| panic!("{e:?}"))
            .contains(&"confirm")
    );
}

#[test]
fn final_audit_cannot_deliver_unreferenced_ranges_with_complete_labels() {
    let reader = noisy_fixture();
    let model = NoisySupport {
        stages: std::sync::Mutex::new(vec![]),
        cancel_compaction: false,
        omit_final_reference: true,
        drop_requested_attribute: false,
    };
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "What is the reactor consumption and what limits apply?",
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(!answer.sufficient());
    assert!(answer.sources.is_empty());
    assert_eq!(chat.stats().calls, 4);
}

#[test]
fn planner_facets_are_retrieval_hints_not_extra_answer_obligations() {
    let clauses =
        question_requirements("Compare logistic regression and random forests for churn.")
            .unwrap_or_else(|e| panic!("{e:?}"));
    let plan = QuestionPlan {
        hints: clauses
            .iter()
            .map(|r| RequirementHints {
                id: r.id,
                terms: vec![],
            })
            .collect(),
        refinements: vec![
            RequirementRefinement {
                clause_id: 1,
                text: "model parameters".into(),
                kind: RequirementKind::Fact,
            },
            RequirementRefinement {
                clause_id: 1,
                text: "performance metrics".into(),
                kind: RequirementKind::Fact,
            },
            RequirementRefinement {
                clause_id: 2,
                text: "model parameters".into(),
                kind: RequirementKind::Fact,
            },
        ],
        prompt_tokens: 1,
        completion_tokens: 1,
    };
    let (coverage, hints) = refine_question(&clauses, &plan).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(coverage.len(), 2);
    for (original, actual) in clauses.iter().zip(&coverage) {
        assert_eq!(original.id, actual.id);
        assert_eq!(original.text, actual.text);
        assert_eq!(original.kind, actual.kind);
    }
    assert!(hints[0].terms.iter().any(|t| t.starts_with("param")));
    let clauses = question_requirements("Compare trials A and B, including limits.")
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(clauses.len(), 3);
    assert_eq!(clauses[2].kind, RequirementKind::Qualification);
}

#[test]
fn selection_and_compaction_keep_ranges_for_requested_attributes() {
    let reader = noisy_fixture();
    let model = NoisySupport {
        stages: std::sync::Mutex::new(vec![]),
        cancel_compaction: false,
        omit_final_reference: false,
        drop_requested_attribute: true,
    };
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "What is the reactor consumption and what limits apply?",
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(answer.sufficient());
    assert_eq!(answer.sources.len(), 2);
    assert!(answer.sources.iter().any(|e| e.path.as_str() == "scope.md"));
    assert!(
        answer
            .sources
            .iter()
            .any(|e| e.path.as_str() == "consumption.md")
    );
    assert!(
        answer
            .sources
            .iter()
            .all(|e| e.path.as_str() != "review.md")
    );
    assert_eq!(chat.stats().calls, 4);
}

#[test]
fn numeric_attribution_requires_the_requested_dimension_and_known_id() {
    let requirements =
        question_requirements("How long was the outage?").unwrap_or_else(|e| panic!("{e:?}"));
    let evidence = vec![
        Evidence {
            text: "The outage lasted 24 minutes.".into(),
            ..source()
        },
        Evidence {
            id: 2,
            text: "Retry concurrency changed from 20 to 4.".into(),
            ..source()
        },
    ];
    let mut value = Assessment {
        support: vec![RequirementSupport {
            id: 1,
            state: SupportState::Supported,
            basis: SupportBasis::Recorded,
            value_evidence_id: Some(1),
            evidence_ids: vec![],
        }],
        served_ids: vec![1, 2],
        prompt_tokens: 10,
        completion_tokens: 10,
    };
    assert!(validate_assessment(&requirements, &evidence, &value).is_ok());
    value.support[0].value_evidence_id = Some(2);
    assert!(validate_assessment(&requirements, &evidence, &value).is_err());
    value.support[0].value_evidence_id = Some(99);
    assert!(validate_assessment(&requirements, &evidence, &value).is_err());
    value.support[0].value_evidence_id = None;
    assert!(validate_assessment(&requirements, &evidence, &value).is_err());
    for text in [
        "The measured lifetime is zero hours.",
        "| Trial | Duration (hours) |\n| --- | --- |\n| A | 4 |",
        "```\nruntime_hours = 4\n```",
    ] {
        assert!(value_evidence_compatible(
            &requirements[0],
            &Evidence {
                text: text.into(),
                ..source()
            }
        ));
    }
    assert!(!value_evidence_compatible(
        &requirements[0],
        &Evidence {
            text: "Battery capacity is 73 watt hours.".into(),
            ..source()
        }
    ));
}

#[test]
fn duration_values_cannot_borrow_a_separate_events_measurement() {
    for subject in ["Bay", "Renamed station", "North pier"] {
        let requirements = question_requirements(&format!(
            "What was the {subject} incident duration and mitigation?"
        ))
        .unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(requirements[0].kind, RequirementKind::Value);
        for (marker, duration) in [
            ("separate", 90),
            ("another", 17),
            ("different", 42),
            ("unrelated", 0),
        ] {
            let distractor = Evidence {
                text: format!(
                    "# {subject} mitigation\nThe operator reduced concurrency from 18 to 3. A {marker} drill lasted {duration} minutes."
                ),
                ..source()
            };
            assert!(!value_evidence_compatible(&requirements[0], &distractor));
            let actual = Evidence {
                text: format!(
                    "The {subject} incident lasted 31 minutes. A {marker} drill lasted {duration} minutes."
                ),
                ..source()
            };
            assert!(value_evidence_compatible(&requirements[0], &actual));
        }
    }
    let drill = question_requirements("How long was the separate drill?")
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(value_evidence_compatible(
        &drill[0],
        &Evidence {
            text: "A separate drill lasted 90 minutes.".into(),
            ..source()
        }
    ));
}

#[test]
fn unassessed_discovery_companions_can_be_removed_before_confirmation() {
    struct Assessor(std::sync::Mutex<Vec<&'static str>>);
    impl ModelService for Assessor {
        fn execute(
            &self,
            job: ModelJob,
            _: Priority,
            _: &Cancellation,
        ) -> Result<ModelResult, PublicError> {
            let (requirements, evidence, stage) = match job {
                ModelJob::PlanQuestion { requirements, .. } => {
                    self.0
                        .lock()
                        .unwrap_or_else(|e| panic!("{e:?}"))
                        .push("plan");
                    return Ok(ModelResult::QuestionPlan(QuestionPlan {
                        refinements: identity_refinements(&requirements),
                        hints: requirements
                            .iter()
                            .map(|r| RequirementHints {
                                id: r.id,
                                terms: vec![],
                            })
                            .collect(),
                        prompt_tokens: 1,
                        completion_tokens: 1,
                    }));
                }
                ModelJob::AssessEvidence {
                    requirements,
                    evidence,
                    purpose,
                    ..
                } => (
                    requirements,
                    evidence,
                    if purpose == AssessmentPurpose::Compact {
                        "compact"
                    } else {
                        "collect"
                    },
                ),
                ModelJob::ConfirmCoverage {
                    requirements,
                    evidence,
                    ..
                } => (requirements, evidence, "confirm"),
                _ => return Err(PublicError::InvalidModelOutput),
            };
            self.0
                .lock()
                .unwrap_or_else(|e| panic!("{e:?}"))
                .push(stage);
            if stage == "compact" {
                assert!(evidence.iter().any(|e| e.path.as_str() == "distractor.md"));
            }
            if stage == "confirm" {
                assert!(evidence.iter().all(|e| e.path.as_str() != "distractor.md"));
            }
            let support = requirements
                .iter()
                .map(|r| {
                    let numerical = r.kind == RequirementKind::Value;
                    let path = if numerical {
                        "timeline.md"
                    } else {
                        "mitigation.md"
                    };
                    let id = evidence
                        .iter()
                        .find(|e| e.path.as_str() == path)
                        .ok_or(PublicError::InvalidModelOutput)?
                        .id;
                    Ok(RequirementSupport {
                        id: r.id,
                        state: SupportState::Supported,
                        basis: SupportBasis::Recorded,
                        value_evidence_id: numerical.then_some(id),
                        evidence_ids: vec![id],
                    })
                })
                .collect::<Result<Vec<_>, PublicError>>()?;
            Ok(ModelResult::Assessment(Assessment {
                support,
                served_ids: evidence.iter().map(|e| e.id).collect(),
                prompt_tokens: 1,
                completion_tokens: 1,
            }))
        }
    }
    let reader = support::Workspace::new(&[
        (
            "timeline.md",
            "# Dock incident\nThe Dock incident lasted 24 minutes.",
        ),
        (
            "mitigation.md",
            "# Dock mitigation\nThe operator reduced concurrency from 20 to 4.",
        ),
        (
            "distractor.md",
            "# Unrelated experiment\nThe experiment changed temperature.",
        ),
    ]);
    let model = Assessor(std::sync::Mutex::new(vec![]));
    let mut chat =
        ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "How long was the Dock incident, and what changed in mitigation?",
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(answer.sufficient());
    assert_eq!(answer.sources.len(), 2);
    assert_eq!(chat.stats().calls, 4);
    assert_eq!(
        *model.0.lock().unwrap_or_else(|e| panic!("{e:?}")),
        vec!["plan", "collect", "compact", "confirm"]
    );
}

#[test]
fn detected_conflicts_cannot_disappear_from_later_assessment_context() {
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Mode {
        Unresolved,
        PartialPacking,
        Corrected,
        Compaction,
    }
    struct ConflictAssessor {
        calls: std::sync::Mutex<usize>,
        original_ids: std::sync::Mutex<Vec<(String, usize)>>,
        mode: Mode,
    }
    impl ModelService for ConflictAssessor {
        fn execute(
            &self,
            job: ModelJob,
            _: Priority,
            _: &Cancellation,
        ) -> Result<ModelResult, PublicError> {
            let (requirements, evidence, stage) = match job {
                ModelJob::PlanQuestion { requirements, .. } => {
                    return Ok(ModelResult::QuestionPlan(QuestionPlan {
                        refinements: identity_refinements(&requirements),
                        hints: requirements
                            .iter()
                            .map(|r| RequirementHints {
                                id: r.id,
                                terms: vec![],
                            })
                            .collect(),
                        prompt_tokens: 1,
                        completion_tokens: 1,
                    }));
                }
                ModelJob::AssessEvidence {
                    requirements,
                    evidence,
                    purpose,
                    ..
                } => (
                    requirements,
                    evidence,
                    if purpose == AssessmentPurpose::Collect {
                        "collect"
                    } else {
                        "compact"
                    },
                ),
                ModelJob::ConfirmCoverage {
                    requirements,
                    evidence,
                    ..
                } => (requirements, evidence, "confirm"),
                _ => return Err(PublicError::InvalidModelOutput),
            };
            let mut calls = self.calls.lock().unwrap_or_else(|e| panic!("{e:?}"));
            let first = stage == "collect" && *calls == 0;
            if stage == "collect" {
                *calls += 1;
            }
            let opposing: Vec<_> = evidence
                .iter()
                .filter(|e| ["a.md", "b.md"].contains(&e.path.as_str()))
                .collect();
            if first {
                assert_eq!(opposing.len(), 2);
                *self.original_ids.lock().unwrap_or_else(|e| panic!("{e:?}")) = opposing
                    .iter()
                    .map(|e| (e.path.as_str().to_owned(), e.id))
                    .collect();
                assert!(evidence.iter().all(|e| e.path.as_str() != "z.md"));
            } else if stage == "collect" && self.mode == Mode::Compaction {
                for (path, id) in self
                    .original_ids
                    .lock()
                    .unwrap_or_else(|e| panic!("{e:?}"))
                    .iter()
                {
                    assert!(
                        evidence
                            .iter()
                            .any(|e| e.path.as_str() == path && e.id == *id),
                        "compaction must retain original ranges and workflow IDs"
                    );
                }
            }
            let correction = evidence.iter().find(|e| e.path.as_str() == "z.md");
            let report_conflict = (first && self.mode != Mode::Compaction)
                || stage == "compact" && self.mode == Mode::Compaction;
            let resolved = self.mode == Mode::Corrected
                && correction.is_some()
                && (opposing.len() == 2 || stage == "confirm");
            // Losing known opposing context makes an isolated later reading
            // appear sufficient. The ledger must prevent this context loss.
            let unresolved = !first
                && !report_conflict
                && !resolved
                && opposing.len() == 2
                && self.mode != Mode::PartialPacking;
            let state = if report_conflict {
                SupportState::Conflicting
            } else if unresolved {
                SupportState::MissingInformation
            } else {
                SupportState::Supported
            };
            let ids = if report_conflict {
                opposing.iter().map(|e| e.id).collect()
            } else if unresolved {
                vec![]
            } else if resolved {
                vec![correction.ok_or(PublicError::InvalidModelOutput)?.id]
            } else if first && self.mode == Mode::Compaction {
                opposing.iter().rev().map(|e| e.id).collect()
            } else {
                vec![evidence[0].id]
            };
            let primary = if state == SupportState::Supported {
                ids.first().copied()
            } else {
                None
            };
            let served_ids = if !first && self.mode == Mode::PartialPacking {
                vec![evidence[0].id]
            } else {
                evidence.iter().map(|e| e.id).collect()
            };
            Ok(ModelResult::Assessment(Assessment {
                support: requirements
                    .iter()
                    .map(|r| RequirementSupport {
                        id: r.id,
                        state,
                        basis: if unresolved {
                            SupportBasis::Absence
                        } else {
                            SupportBasis::Recorded
                        },
                        value_evidence_id: primary,
                        evidence_ids: ids.clone(),
                    })
                    .collect(),
                served_ids,
                prompt_tokens: 1,
                completion_tokens: 1,
            }))
        }
    }
    for mode in [
        Mode::Unresolved,
        Mode::PartialPacking,
        Mode::Corrected,
        Mode::Compaction,
    ] {
        let mut notes = vec![
            (
                "a.md".to_owned(),
                "# Reactor lamps\nReactor lamps were recorded: 42.".to_owned(),
            ),
            (
                "b.md".to_owned(),
                "# Reactor lamps\nReactor lamps were recorded: 43.".to_owned(),
            ),
        ];
        for i in 0..14 {
            notes.push((
                format!("extra-{i:02}.md"),
                format!(
                    "# Reactor lamps\nReactor lamps were recorded using naming format {}.",
                    char::from(b'A' + i)
                ),
            ));
        }
        if mode == Mode::Corrected {
            notes.push(("z.md".into(), "# Correction\nAn audit supersedes all earlier readings. The definitive reactor lamp tally is 64.".into()));
        } else {
            notes.push((
                "z.md".into(),
                "# Deferred tally\nThe reactor lamp tally is 100.".into(),
            ));
        }
        let borrowed = notes
            .iter()
            .map(|(path, body)| (path.as_str(), body.as_str()))
            .collect::<Vec<_>>();
        let reader = support::Workspace::new(&borrowed);
        let model = ConflictAssessor {
            calls: std::sync::Mutex::new(0),
            original_ids: std::sync::Mutex::new(vec![]),
            mode,
        };
        let mut chat =
            ChatSession::new(&reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("{e:?}"));
        let answer = chat
            .ask(
                "How many reactor lamps were recorded?",
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("{e:?}"));
        assert!(
            *model.calls.lock().unwrap_or_else(|e| panic!("{e:?}")) >= 2,
            "the control must reach another assessment"
        );
        if mode == Mode::Corrected {
            assert!(
                answer.sufficient(),
                "a correction assessed with all opposing context can resolve the conflict"
            );
            assert_eq!(answer.sources.len(), 1);
            assert_eq!(answer.sources[0].path.as_str(), "z.md");
            assert!(answer.sources[0].text.contains("64"));
        } else {
            assert!(
                !answer.sufficient(),
                "an isolated later measurement cannot erase a known unresolved contradiction"
            );
            assert!(answer.sources.is_empty());
        }
        assert!(chat.stats().calls <= synapse_core::MAX_MODEL_CALLS);
    }
}
