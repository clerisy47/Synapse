#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::sync::{Arc, Mutex};
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Clock, Evidence, ModelJob, ModelResult, ModelService,
    NotePath, NoteReadPort, Priority, PublicError, WorkspaceIdentity, WorkspaceReadPort,
    verify_evidence,
};

const QUESTION: &str = "What can I try when training loss improves but validation loss worsens?";
const REMEDIES: &str = "# Memorization\nMemorization captures training-specific noise and harms validation performance.\n\n## Remedies\n- Halt fitting before memorization.\n- Reduce model capacity.";

#[derive(Default)]
struct Seen {
    plans: Vec<String>,
    selections: Vec<(String, Vec<Evidence>)>,
}
struct Planner {
    terms: Vec<String>,
    seen: Mutex<Seen>,
    wrong_type: bool,
    unavailable: bool,
    cancel: bool,
    mutate: Option<Arc<MutableWorkspace>>,
    insufficient: bool,
}
impl Planner {
    fn new(terms: &[&str]) -> Self {
        Self {
            terms: terms.iter().map(|term| (*term).into()).collect(),
            seen: Mutex::new(Seen::default()),
            wrong_type: false,
            unavailable: false,
            cancel: false,
            mutate: None,
            insufficient: false,
        }
    }
}
impl ModelService for Planner {
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
            ModelJob::SearchTerms { question } => {
                self.seen
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                    .plans
                    .push(question);
                if let Some(reader) = &self.mutate {
                    reader.notes.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"))[0].1 = "---\ndescription: Revoked\ntags: [fixture]\naliases: []\nvault-synapse: ignore\n---\nREVOKED_SENTINEL\n".into();
                }
                if self.cancel {
                    cancel.cancel();
                }
                if self.unavailable {
                    return Err(PublicError::InvalidModelOutput);
                }
                if self.wrong_type {
                    return Ok(ModelResult::Selected(vec![1]));
                }
                Ok(ModelResult::SearchTerms(self.terms.clone()))
            }
            ModelJob::SelectEvidence { question, evidence } => {
                let ids: Vec<_> = evidence
                    .iter()
                    .filter(|e| {
                        e.text.contains("Halt fitting before memorization.")
                            && e.text.contains("Reduce model capacity.")
                    })
                    .map(|e| e.id)
                    .collect();
                self.seen
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                    .selections
                    .push((question, evidence));
                if self.insufficient || ids.is_empty() {
                    Ok(ModelResult::InsufficientEvidence)
                } else {
                    Ok(ModelResult::Selected(ids))
                }
            }
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

fn session(reader: &impl NoteReadPort) -> ChatSession {
    ChatSession::new(reader, AccessPolicy::default()).unwrap_or_else(|e| panic!("fixture: {e:?}"))
}

#[test]
fn six_remedy_request_forms_plan_once_and_preserve_original_selection_context() {
    let mut reader = Workspace::new(&[
        ("neutral.md", REMEDIES),
        ("excluded.md", "# Ignored\nEXCLUDED_SENTINEL"),
    ]);
    reader.notes[1].1 =
        reader.notes[1]
            .1
            .replacen("aliases: []\n", "aliases: []\nvault-synapse: ignore\n", 1);
    for prefix in [
        "What can I try",
        "What should I try",
        "How can I fix",
        "How do I fix",
        "How should I address",
        "What can I do",
    ] {
        let question = format!("{prefix} when training loss improves but validation loss worsens?");
        let model = Planner::new(&["memorization"]);
        let answer = session(&reader)
            .ask(
                &question,
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert!(answer.sufficient());
        assert!(
            answer
                .sources
                .iter()
                .any(|e| e.text.contains("Reduce model capacity.")
                    && verify_evidence(&reader, &AccessPolicy::default(), e))
        );
        let seen = model
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert_eq!(seen.plans.len(), 1);
        assert_eq!(seen.plans[0], format!("Latest question: {question}"));
        assert!(!seen.selections.is_empty() && seen.plans.len() + seen.selections.len() <= 8);
        for (context, evidence) in &seen.selections {
            assert_eq!(context, &seen.plans[0]);
            assert!(
                !context.contains("EXCLUDED_SENTINEL")
                    && !context.contains("Reduce model capacity")
            );
            assert!(
                evidence
                    .iter()
                    .all(|e| verify_evidence(&reader, &AccessPolicy::default(), e))
            );
        }
    }
}

#[test]
fn invalid_or_failed_planning_does_not_fall_back_to_selection() {
    let reader = Workspace::new(&[("neutral.md", REMEDIES)]);
    let cases = [
        vec![],
        vec!["".into()],
        vec![" \t\n".into()],
        vec!["x".repeat(49)],
        vec!["界".repeat(49)],
        vec!["a".into(), "b".into(), "c".into(), "d".into(), "e".into()],
    ];
    for terms in cases {
        let mut model = Planner::new(&[]);
        model.terms = terms;
        let result = session(&reader).ask(
            QUESTION,
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        );
        assert!(matches!(result, Err(PublicError::InvalidModelOutput)));
        let seen = model
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert_eq!(seen.plans.len(), 1);
        assert!(seen.selections.is_empty());
    }
    for wrong_type in [true, false] {
        let mut model = Planner::new(&["memorization"]);
        model.wrong_type = wrong_type;
        model.unavailable = !wrong_type;
        assert!(matches!(
            session(&reader).ask(
                QUESTION,
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            ),
            Err(PublicError::InvalidModelOutput)
        ));
        assert!(
            model
                .seen
                .lock()
                .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                .selections
                .is_empty()
        );
    }
}

#[test]
fn cancellation_during_planning_suppresses_selection() {
    let reader = Workspace::new(&[("neutral.md", REMEDIES)]);
    let mut model = Planner::new(&["memorization"]);
    model.cancel = true;
    assert!(matches!(
        session(&reader).ask(
            QUESTION,
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default()
        ),
        Err(PublicError::Cancelled)
    ));
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert_eq!(seen.plans.len(), 1);
    assert!(seen.selections.is_empty());
}

#[test]
fn all_answer_questions_plan_but_empty_workspaces_skip_inference() {
    let reader = Workspace::new(&[("neutral.md", REMEDIES)]);
    let model = Planner::new(&["memorization"]);
    assert!(
        session(&reader)
            .ask(
                "What remedies address memorization?",
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .sufficient()
    );
    assert_eq!(
        model
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("{e:?}"))
            .plans
            .len(),
        1
    );
    let empty = Workspace::new(&[]);
    let model = Planner::new(&["memorization"]);
    assert!(
        !session(&empty)
            .ask(
                QUESTION,
                &empty,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .sufficient()
    );
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(seen.plans.is_empty() && seen.selections.is_empty());
}

#[test]
fn broad_irrelevant_terms_cannot_erase_original_terms_or_change_question_filtering() {
    let reader = Workspace::new(&[
        ("neutral.md", REMEDIES),
        (
            "questions.md",
            &format!("| Prompt | Sources |\n| --- | --- |\n| {QUESTION} | [[memorization]] |"),
        ),
    ]);
    let model = Planner::new(&[
        "alpha bravo charlie delta echo foxtrot golf inn",
        "india juliet kilo lima mike november oscar papa",
        "quebec romeo sierra tango uniform victor whiskey",
        "xray yankee zulu apple berry cedar maple fir oak",
    ]);
    let answer = session(&reader)
        .ask(
            QUESTION,
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(answer.sufficient());
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert_eq!(seen.plans.len(), 1);
    assert!(seen.plans.len() + seen.selections.len() <= 8);
    // Question lists remain discoverable; planning must preserve the original
    // question filter/context and the real remedy rather than ban their paths.
    assert!(
        seen.selections
            .iter()
            .all(|(context, _)| context == &format!("Latest question: {QUESTION}"))
    );
    assert!(
        answer
            .sources
            .iter()
            .all(|e| e.path.as_str() != "questions.md")
    );
    assert!(
        answer
            .sources
            .iter()
            .any(|e| e.path.as_str() == "neutral.md"
                && e.text.contains("Halt fitting before memorization.")
                && e.text.contains("Reduce model capacity."))
    );
}

#[test]
fn irrelevant_plan_does_not_prove_unsupported_remedy() {
    let reader = Workspace::new(&[("garden.md", "# Orchids\nOrchids bloom in the greenhouse.")]);
    let mut model = Planner::new(&["orchids"]);
    model.insufficient = true;
    assert!(
        !session(&reader)
            .ask(
                QUESTION,
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .sufficient()
    );
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert_eq!(seen.plans.len(), 1);
    assert!(seen.plans.len() + seen.selections.len() <= 8);
}

#[test]
fn exhausted_lexical_union_is_explicit_instead_of_dropping_all_new_plan_terms() {
    let reader = Workspace::new(&[("neutral.md", REMEDIES)]);
    let question = format!(
        "What can I try {}",
        (0..40)
            .map(|i| format!("term{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let model = Planner::new(&["memorization"]);
    assert!(matches!(
        session(&reader).ask(
            &question,
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default()
        ),
        Err(PublicError::ContextOverflow)
    ));
    assert!(
        model
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .selections
            .is_empty()
    );
}

struct MutableWorkspace {
    identity: WorkspaceIdentity,
    notes: Mutex<Vec<(NotePath, String)>>,
}
impl MutableWorkspace {
    fn new() -> Self {
        let w = Workspace::new(&[("neutral.md", REMEDIES)]);
        Self {
            identity: WorkspaceIdentity::from_canonical_display("mutable-synthetic".into()),
            notes: Mutex::new(w.notes),
        }
    }
}
impl Clock for MutableWorkspace {
    fn monotonic_millis(&self) -> u64 {
        0
    }
    fn unix_seconds(&self) -> Result<u64, PublicError> {
        Ok(0)
    }
}
impl WorkspaceReadPort for MutableWorkspace {
    fn identity(&self) -> &WorkspaceIdentity {
        &self.identity
    }
}
impl NoteReadPort for MutableWorkspace {
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError> {
        Ok(self
            .notes
            .lock()
            .unwrap_or_else(|e| panic!("fixture:{e:?}"))
            .iter()
            .map(|(p, _)| p.clone())
            .collect())
    }
    fn read_note(&self, path: &NotePath) -> Result<String, PublicError> {
        self.notes
            .lock()
            .unwrap_or_else(|e| panic!("fixture:{e:?}"))
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, b)| b.clone())
            .ok_or(PublicError::AccessRefused)
    }
    fn modified_note(&self, _: &NotePath) -> Result<u64, PublicError> {
        Ok(0)
    }
}

#[test]
fn exclusion_change_during_planning_never_reaches_selection() {
    let reader = Arc::new(MutableWorkspace::new());
    let mut model = Planner::new(&["memorization"]);
    model.mutate = Some(reader.clone());
    let answer = session(reader.as_ref()).ask(
        QUESTION,
        reader.as_ref(),
        &AccessPolicy::default(),
        &model,
        &Cancellation::default(),
    );
    assert!(matches!(answer, Err(PublicError::AccessRefused)));
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture:{e:?}"));
    assert_eq!(seen.plans.len(), 1);
    assert!(seen.selections.is_empty());
}

#[test]
fn one_plan_allows_bounded_distinct_assessments_until_exhaustion() {
    let notes: Vec<_> = (0..8).map(|index| (format!("note{index}.md"), format!("# Loss diagnostics\nTraining loss improves but validation loss worsens in diagnostic scenario {index}.\n{}", "This diagnostic records optimization context. ".repeat(3)))).collect();
    let borrowed: Vec<_> = notes
        .iter()
        .map(|(path, body)| (path.as_str(), body.as_str()))
        .collect();
    let reader = Workspace::new(&borrowed);
    let mut model = Planner::new(&["diagnostics"]);
    model.insufficient = true;
    let answer = session(&reader)
        .ask(
            QUESTION,
            &reader,
            &AccessPolicy::default(),
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!answer.sufficient());
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert_eq!(seen.plans.len(), 1);
    assert!(!seen.selections.is_empty() && seen.selections.len() <= 6);
    assert!(seen.plans.len() + seen.selections.len() <= 7);
    let signature = |evidence: &[Evidence]| {
        evidence
            .iter()
            .map(|e| (e.path.as_str().to_owned(), e.start_line, e.end_line))
            .collect::<Vec<_>>()
    };
    for pair in seen.selections.windows(2) {
        assert_ne!(signature(&pair[0].1), signature(&pair[1].1));
    }
    assert!(seen.selections.iter().all(|(context, evidence)| {
        context == &seen.plans[0]
            && evidence
                .iter()
                .all(|e| verify_evidence(&reader, &AccessPolicy::default(), e))
    }));
}

#[test]
fn valid_unicode_boundary_and_already_present_concepts_are_accepted() {
    let reader = Workspace::new(&[("neutral.md", REMEDIES)]);
    let mut model = Planner::new(&[]);
    model.terms = vec!["界".repeat(48)];
    assert!(
        session(&reader)
            .ask(
                QUESTION,
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .sufficient()
    );
    let question = format!(
        "What can I try memorization {}",
        (0..40)
            .map(|i| format!("term{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let model = Planner::new(&["memorization"]);
    assert!(
        session(&reader)
            .ask(
                &question,
                &reader,
                &AccessPolicy::default(),
                &model,
                &Cancellation::default()
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .sufficient()
    );
}
