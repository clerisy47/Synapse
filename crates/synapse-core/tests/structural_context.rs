#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::{fmt::Write, sync::Mutex};
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    Priority, PublicError, verify_evidence,
};

#[derive(Default)]
struct SelectAll(Mutex<Vec<Vec<Evidence>>>);
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
            ModelJob::SelectEvidence { evidence, .. } => {
                let ids = evidence.iter().map(|e| e.id).collect();
                self.0
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                    .push(evidence);
                Ok(ModelResult::Selected(ids))
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["remedies".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn selected_counterexamples_keep_authentic_title_definition_and_heading() {
    let reader = Workspace::new(&[
        (
            "a.md",
            "# Thermal overload\nThermal overload harms equipment when cooling fails.\n\n## Examples\n- Block the cooling vents.\n- Disable the cooling fan.",
        ),
        (
            "b.md",
            "# Cooling\nCooling failures raise device temperature.\n\n## Remedies\n- Clear the cooling vents.\n- Restore the cooling fan.",
        ),
    ]);
    let policy = AccessPolicy::default();
    let model = SelectAll::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "What can I try when cooling fails?",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(answer.sufficient());
    let sources = &answer.sources;
    assert!(
        sources
            .iter()
            .any(|e| e.text.contains("Clear the cooling vents."))
    );
    let examples: Vec<_> = sources
        .iter()
        .filter(|e| e.text.contains("Block the cooling vents."))
        .collect();
    assert!(
        !examples.is_empty(),
        "mock must select the actual counterexample, not avoid the context assertion"
    );
    for source in examples {
        assert!(source.text.contains("# Thermal overload"));
        assert!(
            source
                .text
                .contains("Thermal overload harms equipment when cooling fails.")
        );
        assert!(source.text.contains("## Examples"));
        assert!(verify_evidence(&reader, &policy, source));
        assert_eq!(source.start_line, 6);
        assert!(source.text.lines().count() <= 24 && source.text.chars().count() <= 1200);
    }
    let calls = model.0.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!calls.is_empty() && calls.len() <= 3);
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| verify_evidence(&reader, &policy, e))
    );
    assert!(
        calls
            .iter()
            .flatten()
            .filter(|e| e.text.contains("Block the cooling vents."))
            .all(|e| e.text.contains("# Thermal overload") && e.text.contains("## Examples"))
    );
}

#[test]
fn late_standalone_checklist_keeps_local_governing_heading() {
    let body = format!(
        "# Handbook\n{}\n## Trail equipment checklist\n- Water flask\n- Offline map\n- Headlamp\n",
        "Background context.\n".repeat(45)
    );
    let reader = Workspace::new(&[("neutral.md", &body)]);
    let policy = AccessPolicy::default();
    let model = SelectAll::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "List the complete trail equipment checklist.",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(answer.sufficient());
    let source = answer
        .sources
        .iter()
        .find(|e| e.text.contains("Water flask"))
        .unwrap_or_else(|| panic!("late checklist missing"));
    assert!(source.text.contains("## Trail equipment checklist"));
    assert!(source.text.contains("Offline map") && source.text.contains("Headlamp"));
    assert!(verify_evidence(&reader, &policy, source));
    assert!(source.text.lines().count() <= 24 && source.text.chars().count() <= 1200);
    assert!(
        model
            .0
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"))
            .len()
            <= 3
    );
}

#[test]
fn structural_passage_is_refused_when_immediate_context_cannot_fit() {
    let body = format!(
        "# Cooling counterexamples\n{}\n- Block cooling vents.\n- Disable cooling fan.\n",
        "Context establishes why cooling actions are dangerous.\n".repeat(27)
    );
    let reader = Workspace::new(&[("neutral.md", &body)]);
    let policy = AccessPolicy::default();
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let evidence = corpus.query("block vents disable fan", &reader, &policy);
    assert!(
        evidence
            .iter()
            .all(|e| !e.text.contains("- Block cooling vents.")),
        "oversized required context must not be silently stripped"
    );
    assert!(
        evidence
            .iter()
            .all(|e| verify_evidence(&reader, &policy, e))
    );
}

#[test]
fn cap_adjacent_context_and_complete_tail_reach_model_without_clipping() {
    let mut items = String::new();
    for index in 1..=17 {
        writeln!(items, "- Sensor equipment item {index}.")
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    }
    items.push_str("- Sensor equipment final sentinel 641.\n");
    let prefix = "# Sensor equipment checklist\nContext explains this sensor equipment inventory: ";
    let fixed = prefix.len() + "\n\n".len() + items.len();
    let body = format!("{prefix}{}\n\n{items}", "x".repeat(1180 - fixed));
    assert_eq!(body.chars().count(), 1180);
    let reader = Workspace::new(&[("neutral.md", &body)]);
    let policy = AccessPolicy::default();
    let model = SelectAll::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "List the complete sensor equipment checklist.",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(
        answer
            .sources
            .iter()
            .any(|e| e.text.starts_with("# Sensor equipment checklist")
                && e.text.contains("Context explains")
                && e.text.contains("final sentinel 641"))
    );
    let calls = model.0.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!calls.is_empty() && calls.len() <= 3);
    assert!(
        calls
            .iter()
            .flatten()
            .any(|e| e.text.starts_with("# Sensor equipment checklist")
                && e.text.contains("Context explains")
                && e.text.contains("final sentinel 641")
                && e.text.chars().count() <= 1200
                && e.text.lines().count() <= 24)
    );
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| verify_evidence(&reader, &policy, e))
    );

    let oversized = body.replace(
        "Context explains",
        &format!("{}Context explains", "y".repeat(60)),
    );
    let reader = Workspace::new(&[("neutral.md", &oversized)]);
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let evidence = corpus.query("sensor equipment final sentinel", &reader, &policy);
    assert!(
        evidence
            .iter()
            .all(|e| !e.text.contains("- Sensor equipment")),
        "block must be refused when required prefix cannot fit"
    );
}

#[test]
fn untitled_note_retains_its_framing_prose_before_examples() {
    let reader = Workspace::new(&[(
        "neutral.md",
        "Cooling counterexamples damage equipment.\n\n- Block cooling vents.\n- Disable cooling fan.",
    )]);
    let policy = AccessPolicy::default();
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let evidence = corpus.query("block cooling vents", &reader, &policy);
    let examples: Vec<_> = evidence
        .iter()
        .filter(|e| e.text.contains("- Block cooling vents."))
        .collect();
    assert!(!examples.is_empty());
    assert!(examples.iter().all(|e| {
        e.text
            .starts_with("Cooling counterexamples damage equipment.")
            && verify_evidence(&reader, &policy, e)
    }));
}
