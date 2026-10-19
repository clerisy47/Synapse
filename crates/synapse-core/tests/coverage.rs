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
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        match job {
            ModelJob::SelectEvidence { evidence, .. } => Ok(ModelResult::Selected(
                evidence.iter().map(|e| e.id).collect(),
            )),
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
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        match job {
            ModelJob::SelectEvidence { evidence, .. } => {
                Ok(ModelResult::Selected(vec![evidence[0].id]))
            }
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}
#[test]
fn provider_cannot_declare_a_partial_checklist_complete() {
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
    assert!(!answer.sufficient());
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
fn oversized_indivisible_window_fails_explicitly_without_a_model_call() {
    let body = format!("window {}", "x".repeat(1100));
    let reader = Workspace::new(&[("alpha.md", &body)]);
    let policy = AccessPolicy::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture {e:?}"));
    let question = format!("window {}", "q".repeat(700));
    assert!(matches!(
        session.ask(
            &question,
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default()
        ),
        Err(PublicError::ContextOverflow)
    ));
}
