//! Deterministic holdout transformations; mocked selection is not live quality evidence.
#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::sync::Mutex;
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Evidence, ModelJob, ModelResult, ModelService,
    Priority, PublicError, verify_evidence,
};

#[derive(Default)]
struct SelectCaptured(Mutex<Vec<Vec<Evidence>>>);
impl ModelService for SelectCaptured {
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
                let ids = evidence.iter().map(|e| e.id).collect();
                self.0
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture lock: {e:?}"))
                    .push(evidence);
                Ok(ModelResult::Selected(ids))
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

fn ask(
    session: &mut ChatSession,
    reader: &Workspace,
    question: &str,
    expected_path: &str,
    facts: &[&str],
) -> Vec<Evidence> {
    let policy = AccessPolicy::default();
    let model = SelectCaptured::default();
    let answer = session
        .ask(question, reader, &policy, &model, &Cancellation::default())
        .unwrap_or_else(|e| panic!("fixture question: {e:?}"));
    let calls = model
        .0
        .lock()
        .unwrap_or_else(|e| panic!("fixture lock: {e:?}"));
    assert!(!calls.is_empty() && calls.len() <= 3);
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| verify_evidence(reader, &policy, e))
    );
    assert!(
        answer.sufficient(),
        "transformed factual evidence was refused"
    );
    assert!(
        answer
            .sources
            .iter()
            .all(|e| verify_evidence(reader, &policy, e))
    );
    for fact in facts {
        assert!(
            answer
                .sources
                .iter()
                .any(|e| e.path.as_str() == expected_path && e.text.contains(fact)),
            "transformed evidence lost {fact} from {expected_path}"
        );
    }
    answer.sources
}

#[test]
fn neutral_note_path_renames_preserve_factual_subject_support() {
    let body = "# Reactor\nThe synthetic reactor consumes 47 units per cycle.";
    for path in [
        "a.md",
        "Archive/opaque-29.md",
        "Unrelated folder/neutral.md",
    ] {
        let reader = Workspace::new(&[
            (path, body),
            ("decoy.md", "# Garden\nFlowers bloom at dawn."),
        ]);
        let mut session = ChatSession::new(&reader, AccessPolicy::default())
            .unwrap_or_else(|e| panic!("fixture session: {e:?}"));
        ask(
            &mut session,
            &reader,
            "How many units does the synthetic reactor consume per cycle?",
            path,
            &["47 units"],
        );
    }
}

#[test]
fn paragraph_relocation_preserves_exact_fresh_citation_coordinates() {
    let fact = "The synthetic observatory telescope has an aperture of 137 millimeters.";
    for padding in [0, 19, 53] {
        let body = format!(
            "# Observatory\n{}\n## Telescope\n{fact}\n",
            "Background context without measurements.\n".repeat(padding)
        );
        let reader = Workspace::new(&[("neutral.md", &body)]);
        let mut session = ChatSession::new(&reader, AccessPolicy::default())
            .unwrap_or_else(|e| panic!("fixture session: {e:?}"));
        let evidence = ask(
            &mut session,
            &reader,
            "How much aperture does the synthetic observatory telescope have?",
            "neutral.md",
            &[fact],
        );
        // Five fixture metadata lines precede the body. The fact follows the
        // title, padding, blank separator and section heading.
        let expected_line = 5 + padding + 4;
        let source = evidence
            .iter()
            .find(|e| e.text.lines().any(|line| line == fact))
            .unwrap_or_else(|| panic!("relocated fact missing"));
        let offset = source
            .text
            .lines()
            .position(|line| line == fact)
            .unwrap_or_else(|| panic!("relocated fact offset missing"));
        assert_eq!(source.start_line + offset, expected_line);
    }
}

#[test]
fn fresh_worked_values_replace_previous_session_values() {
    let question = "What are precision and recall in the synthetic worked example?";
    let mut reader = Workspace::new(&[(
        "metrics.md",
        "# Metrics\nThe synthetic worked example has precision 0.82 and recall 0.41.",
    )]);
    let mut session = ChatSession::new(&reader, AccessPolicy::default())
        .unwrap_or_else(|e| panic!("fixture session: {e:?}"));
    ask(
        &mut session,
        &reader,
        question,
        "metrics.md",
        &["0.82", "0.41"],
    );
    reader.notes[0].1 = reader.notes[0]
        .1
        .replace("0.82", "0.93")
        .replace("0.41", "0.57");
    let sources = ask(
        &mut session,
        &reader,
        question,
        "metrics.md",
        &["0.93", "0.57"],
    );
    assert!(sources.iter().all(|e| !e.text.contains("0.82")
        && !e.text.contains("0.41")
        && !e.text.contains("0.75")
        && !e.text.contains("0.60")));
}

#[test]
fn checklist_marker_and_item_order_transformations_keep_every_item() {
    let items = [
        "Water flask",
        "Rain shell",
        "Offline navigation",
        "Spare headlamp",
    ];
    // Fixed permutations avoid nondeterministic random test behavior.
    for (style, order) in [(0, [0, 1, 2, 3]), (1, [3, 1, 0, 2]), (2, [2, 0, 3, 1])] {
        let lines = order
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let marker = match style {
                    0 => "-".to_owned(),
                    1 => "*".to_owned(),
                    _ => format!("{}.", index + 1),
                };
                format!("{marker} {}", items[*item])
            })
            .collect::<Vec<_>>()
            .join("\n");
        let body = format!("# Trail equipment checklist\n{lines}\n");
        let reader = Workspace::new(&[("equipment.md", &body)]);
        let mut session = ChatSession::new(&reader, AccessPolicy::default())
            .unwrap_or_else(|e| panic!("fixture session: {e:?}"));
        ask(
            &mut session,
            &reader,
            "List the complete trail equipment checklist.",
            "equipment.md",
            &items,
        );
    }
}
