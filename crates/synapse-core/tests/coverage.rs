#[path = "support/protocol.rs"]
mod protocol;
mod support;

use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    NoteReadPort, Priority, PublicError, verify_evidence,
};

struct SelectAll;
impl ModelService for SelectAll {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        protocol_cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let job = match protocol::adapt(self, job, priority, protocol_cancel) {
            Ok(job) => job,
            Err(result) => return result,
        };

        match job {
            ModelJob::SelectEvidence { evidence, .. } => Ok(ModelResult::Selected(
                evidence.iter().map(|e| e.id).collect(),
            )),
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec![
                "marine".into(),
                "whale".into(),
                "gestation".into(),
            ])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

const INTRO: &str = "# Overview\nGeneral background for this topic.\nDefinitions are introduced here.\nRelated reading follows.\nThis introduction contains no worked answer.\nMore context.\nMore background.\n";

fn check(question: &str, notes: &[(&str, &str)], facts: &[(&str, &str)]) {
    let mut bodies: Vec<_> = notes
        .iter()
        .map(|(p, b)| (*p, format!("{INTRO}{b}")))
        .collect();
    bodies.push(("questions.md", format!("# Practice questions\n{question}\nSee the linked topic notes for answers.\n[[alpha]] [[beta]]")));
    bodies.push((
        "unrelated.md",
        "# Unrelated\nOrchids grow in the synthetic greenhouse.".into(),
    ));
    let borrowed: Vec<_> = bodies.iter().map(|(p, b)| (*p, b.as_str())).collect();
    let reader = Workspace::new(&borrowed);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let evidence = corpus.query(question, &reader, &policy);
    authentic(&reader, &policy, &evidence);
    for (path, fact) in facts {
        assert!(
            evidence
                .iter()
                .any(|e| e.path.as_str() == *path && e.text.contains(fact)),
            "missing required fact {fact} from {path}"
        );
    }
    assert!(
        evidence
            .first()
            .is_some_and(|e| e.path.as_str() != "questions.md"),
        "question repetition outranks factual evidence"
    );
    let mut session = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let answer = session
        .ask(
            question,
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    authentic(&reader, &policy, &answer.sources);
    for (path, fact) in facts {
        assert!(
            answer
                .sources
                .iter()
                .any(|e| e.path.as_str() == *path && e.text.contains(fact)),
            "model input lost {fact} from {path}"
        );
    }
}

fn authentic(reader: &Workspace, policy: &AccessPolicy, evidence: &[Evidence]) {
    for (index, e) in evidence.iter().enumerate() {
        assert_eq!(e.id, index + 1);
        assert!(verify_evidence(reader, policy, e));
        let bytes = reader
            .read_note(&e.path)
            .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
        assert_eq!(
            bytes
                .lines()
                .skip(e.start_line - 1)
                .take(e.end_line - e.start_line + 1)
                .collect::<Vec<_>>()
                .join("\n"),
            e.text
        );
    }
}

#[test]
fn leakage_timing_beyond_introduction() {
    check(
        "When does leakage happen relative to the outcome?",
        &[(
            "alpha.md",
            "# Leakage\nLeakage happens when predictors become available after the outcome.",
        )],
        &[("alpha.md", "after the outcome")],
    );
}
#[test]
fn comparison_requires_both_notes() {
    check(
        "Compare logistic and forest predictions and threshold behavior",
        &[
            (
                "alpha.md",
                "# Logistic\nLogistic predictions use a linear boundary.\nThe threshold controls the positive decision.",
            ),
            (
                "beta.md",
                "# Forest\nForest predictions capture nonlinear interactions.",
            ),
        ],
        &[
            ("alpha.md", "threshold controls"),
            ("beta.md", "nonlinear interactions"),
        ],
    );
}
#[test]
fn numeric_worked_example_beyond_table_header() {
    check(
        "What are precision and recall in the worked example?",
        &[(
            "alpha.md",
            "# Precision and recall\nDefinitions describe the metrics.\n\n## Worked example\n| Metric | Value |\n| --- | --- |\n| Precision | 0.75 |\n| Recall | 0.60 |",
        )],
        &[("alpha.md", "0.75"), ("alpha.md", "0.60")],
    );
}
#[test]
fn chronological_guidance_beyond_definition() {
    check(
        "How should a time series split training and validation?",
        &[(
            "alpha.md",
            "# Time series split\nTraining and validation estimate generalization.\n\n## Procedure\nUse chronological ordering: earlier rows train; later rows validate.",
        )],
        &[
            ("alpha.md", "chronological ordering"),
            ("alpha.md", "later rows validate"),
        ],
    );
}
#[test]
fn early_stopping_in_complete_regularization_list() {
    check(
        "List the regularization methods for overfitting",
        &[(
            "alpha.md",
            "# Overfitting regularization\nMethods follow.\n\n- Penalize coefficients.\n- Limit tree depth.\n- Add dropout.\n- Augment training data.\n- Use cross validation.\n- Early stopping on held-out loss.",
        )],
        &[
            ("alpha.md", "Penalize coefficients"),
            ("alpha.md", "Early stopping"),
        ],
    );
}
#[test]
fn hiking_checklist_preserves_tail() {
    check(
        "What is the complete hiking checklist?",
        &[(
            "alpha.md",
            "# Hiking checklist\n- Map and compass\n- Water and snacks\n- Insulation\n- Rain protection\n- First aid\n- Sun protection\n- Headlamp",
        )],
        &[
            ("alpha.md", "Map and compass"),
            ("alpha.md", "Water and snacks"),
            ("alpha.md", "Insulation"),
            ("alpha.md", "Rain protection"),
            ("alpha.md", "First aid"),
            ("alpha.md", "Sun protection"),
            ("alpha.md", "Headlamp"),
        ],
    );
}

#[test]
fn metadata_and_links_do_not_establish_facts() {
    let reader = Workspace::new(&[
        ("marine.md", "[[ocean]]"),
        (
            "accuracy.md",
            "# Accuracy\nNo measurement has been performed.",
        ),
    ]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    // Discovery may return these notes; neither supplies the requested fact.
    for question in [
        "marine whale gestation duration",
        "accuracy measured percentage",
    ] {
        let evidence = corpus.query(question, &reader, &policy);
        authentic(&reader, &policy, &evidence);
        assert!(
            evidence
                .iter()
                .all(|e| !e.text.contains("97%") && !e.text.contains("365 days"))
        );
    }
}

#[test]
fn topical_selection_without_numeric_support_abstains() {
    let reader = Workspace::new(&[(
        "accuracy.md",
        "# Accuracy\nAccuracy is a planned measurement; no result exists.",
    )]);
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let answer = session
        .ask(
            "What was the measured accuracy?",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    assert!(!answer.sufficient());
    assert!(answer.sources.is_empty());
}

struct SelectFirst;
impl ModelService for SelectFirst {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        protocol_cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let job = match protocol::adapt(self, job, priority, protocol_cancel) {
            Ok(job) => job,
            Err(result) => return result,
        };

        match job {
            ModelJob::SelectEvidence { evidence, .. } => {
                Ok(ModelResult::Selected(vec![evidence[0].id]))
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}
#[test]
fn first_selected_atomic_checklist_preserves_every_item() {
    let reader = Workspace::new(&[(
        "gear.md",
        "# Hiking checklist\n- Map\n- Water\n- Food\n- Coat\n- First aid\n- Sun protection\n- Headlamp",
    )]);
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let answer = session
        .ask(
            "Complete hiking checklist",
            &reader,
            &policy,
            &SelectFirst,
            &Cancellation::default(),
        )
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    assert!(answer.sufficient());
    for item in [
        "Map",
        "Water",
        "Food",
        "Coat",
        "First aid",
        "Sun protection",
        "Headlamp",
    ] {
        assert!(
            answer
                .sources
                .iter()
                .any(|source| source.text.contains(item))
        );
    }
}

#[test]
fn linked_note_expansion_ranks_late_unicode_body_and_rechecks_access() {
    let body = format!("{INTRO}# Café navigation\nCafé navigation requires a compass and a map.");
    let mut reader = Workspace::new(&[("alpha.md", &body)]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let path = reader.notes[0].0.clone();
    let evidence = corpus.query_note(&path, "CAFÉ navigation", &reader, &policy);
    authentic(&reader, &policy, &evidence);
    assert!(
        evidence
            .iter()
            .any(|e| e.text.contains("compass and a map"))
    );
    let excluded = AccessPolicy {
        tags: vec!["fixture".into()],
        ..policy.clone()
    };
    assert!(
        corpus
            .query_note(&path, "café navigation", &reader, &excluded)
            .is_empty()
    );
    reader.notes[0].1.push_str("Changed bytes");
    assert!(
        corpus
            .query_note(&path, "café navigation", &reader, &policy)
            .is_empty()
    );
}

#[test]
fn a_comparison_cannot_select_only_one_subject() {
    let reader = Workspace::new(&[
        ("alpha.md", "Logistic predictions use a linear boundary."),
        (
            "beta.md",
            "Forest predictions capture nonlinear interactions.",
        ),
    ]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "Compare logistic and forest predictions",
            &reader,
            &policy,
            &SelectFirst,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(!answer.sufficient());
}

#[test]
fn formerly_byte_limited_window_remains_complete_under_token_packing() {
    let body = format!("window {}", "x".repeat(1100));
    let reader = Workspace::new(&[("alpha.md", &body)]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let question = format!("window {}", "q".repeat(700));
    let answer = session
        .ask(
            &question,
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(answer.sufficient());
    assert!(answer.sources.iter().any(|e| e.text == body));
}

#[test]
fn headings_and_repeated_questions_are_not_answer_evidence() {
    for (question, body) in [
        (
            "How many days is whale gestation?",
            "# Whale gestation 365\nHow many days is whale gestation?\n[[marine]]",
        ),
        (
            "What is known about marine whale biology?",
            "# Marine whale biology\nWhat is known about marine whale biology?\n[[marine]]",
        ),
    ] {
        let reader = Workspace::new(&[("question.md", body)]);
        let policy = AccessPolicy::default();
        let mut session =
            ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
        let answer = session
            .ask(
                question,
                &reader,
                &policy,
                &SelectAll,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("fixture {e:?}"));
        assert!(!answer.sufficient());
    }
}

#[test]
fn shared_comparison_attribute_does_not_stand_in_for_missing_subject() {
    let reader = Workspace::new(&[(
        "alpha.md",
        "Logistic predictions use a linear boundary. The predictions use a threshold.",
    )]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "Compare logistic and forest predictions",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(!answer.sufficient());
}

struct RejectFirst(std::sync::atomic::AtomicUsize);
impl ModelService for RejectFirst {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        protocol_cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let job = match protocol::adapt(self, job, priority, protocol_cancel) {
            Ok(job) => job,
            Err(result) => return result,
        };

        match job {
            ModelJob::SelectEvidence { evidence, .. } => {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(ModelResult::Selected(
                    evidence.iter().map(|e| e.id).collect(),
                ))
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn rejected_topical_selection_uses_remaining_budget_for_linked_answer() {
    let reader = Workspace::new(&[
        (
            "alpha.md",
            "# Measured accuracy\nWhat was the measured accuracy?\n[[beta]]",
        ),
        ("beta.md", "The measured accuracy was 97 percent."),
    ]);
    let policy = AccessPolicy::default();
    let model = RejectFirst(std::sync::atomic::AtomicUsize::new(0));
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "What was the measured accuracy?",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(answer.sufficient());
    assert!(answer.sources.iter().any(|e| e.text.contains("97 percent")));
    assert!(model.0.load(std::sync::atomic::Ordering::SeqCst) <= 3);
}

#[test]
fn complete_numbered_checklist_does_not_require_unrelated_section() {
    check(
        "What is the complete hiking checklist?",
        &[(
            "alpha.md",
            "# Hiking checklist\n1. Map and compass\n2. Water and snacks\n\n# Gardening supplies\n- Spade\n- Pots\n- Compost\n- Seeds\n- Gloves\n- Hose\n- Fertilizer\n- Rake",
        )],
        &[
            ("alpha.md", "Map and compass"),
            ("alpha.md", "Water and snacks"),
        ],
    );
}

#[test]
fn prompt_table_with_prose_and_subject_links_cannot_answer_comparison() {
    let reader = Workspace::new(&[(
        "questions.md",
        "These prompts describe expected evidence, not results.\n\n| Prompt | Relevant sources |\n| --- | --- |\n| Compare cedar and birch for insulation. | [[cedar]] [[birch]] |",
    )]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "Compare cedar and birch for insulation.",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(!answer.sufficient());
}

#[test]
fn unrelated_synthetic_metric_and_project_navigation_do_not_prove_measurement() {
    let reader = Workspace::new(&[(
        "metrics.md",
        "In a synthetic example, accuracy is 0.82.\n\nThreshold selection depends on costs. See [[Orchid Trial]].",
    )]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "What was the Orchid trial's measured test accuracy?",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(!answer.sufficient());
}

#[test]
fn requested_subject_measurement_in_factual_prose_is_supported() {
    check(
        "What was the Orchid experiment's measured test accuracy?",
        &[(
            "alpha.md",
            "The Orchid experiment measured test accuracy of 0.91 on held-out examples.",
        )],
        &[("alpha.md", "0.91")],
    );
}

#[test]
fn dated_absence_of_measurement_is_not_a_numeric_result() {
    let reader = Workspace::new(&[("orchid.md", "Orchid accuracy was not recorded in 2031.")]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let answer = session
        .ask(
            "What was the Orchid experiment's measured accuracy?",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture {e:?}"));
    assert!(!answer.sufficient());
}

#[test]
fn achieved_and_reported_accuracy_require_prose_subject_attribution() {
    for question in [
        "What accuracy did Orchid achieve?",
        "What was Orchid's reported test accuracy?",
    ] {
        let reader = Workspace::new(&[("orchid.md", "In a synthetic example, accuracy is 0.82.")]);
        let policy = AccessPolicy::default();
        let mut session =
            ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
        let answer = session
            .ask(
                question,
                &reader,
                &policy,
                &SelectAll,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("fixture {e:?}"));
        assert!(
            !answer.sufficient(),
            "filename discovery cannot prove attribution"
        );
    }
    check(
        "What accuracy did Orchid achieve?",
        &[(
            "alpha.md",
            "Orchid achieved accuracy of 0.91 on held-out examples.",
        )],
        &[("alpha.md", "0.91")],
    );
}

#[test]
fn single_word_question_does_not_remove_matching_factual_sentence() {
    check(
        "reactor",
        &[("alpha.md", "The reactor operates at 42 units.")],
        &[("alpha.md", "42 units")],
    );
}

#[test]
fn actionable_question_keeps_remedy_section_beyond_diagnosis() {
    check(
        "What can I try when appliance temperature rises under load?",
        &[(
            "alpha.md",
            "# Appliance temperature\nAppliance temperature rises under load when cooling is inadequate.\n\n## Mitigations\n- Reduce the sustained load.\n- Improve ventilation around the appliance.",
        )],
        &[
            ("alpha.md", "Reduce the sustained load"),
            ("alpha.md", "Improve ventilation"),
        ],
    );
}
