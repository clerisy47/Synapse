#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::sync::Mutex;
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    Priority, PublicError,
};

#[derive(Default)]
struct Capture(Mutex<Vec<Vec<Evidence>>>);
impl ModelService for Capture {
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
                self.0
                    .lock()
                    .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"))
                    .push(evidence);
                Ok(ModelResult::InsufficientEvidence)
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["remedies".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn linked_overviews_do_not_displace_substantive_subjects_from_model_input() {
    let reader = Workspace::new(&[
        (
            "map.md",
            "# Map\n- [[Amber classifier]] and [[Birch ensemble]] are useful baselines.\n- [[Amber classifier]] and [[Birch ensemble]] describe models.\n\nApplied example: [[Forecast experiment]].",
        ),
        (
            "project.md",
            "# Forecast experiment\nStart with [[Amber classifier]], then compare [[Birch ensemble]].",
        ),
        (
            "amber.md",
            "# Amber classifier\nAmber classifier uses a linear boundary and configurable threshold.",
        ),
        (
            "birch.md",
            "# Birch ensemble\nBirch ensemble captures nonlinear interactions through averaging.",
        ),
    ]);
    let policy = AccessPolicy::default();
    let model = Capture::default();
    let mut chat = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    chat.ask(
        "Compare amber classifier and birch ensemble for forecast.",
        &reader,
        &policy,
        &model,
        &Cancellation::default(),
    )
    .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let calls = model
        .0
        .lock()
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| synapse_core::verify_evidence(&reader, &policy, e))
    );
    let first = &calls[0];
    assert_eq!(first[0].path.as_str(), "amber.md");
    assert_eq!(first[1].path.as_str(), "birch.md");
    assert!(
        first
            .iter()
            .any(|e| e.text.contains("configurable threshold"))
    );
    assert!(calls.len() <= 3);
}

#[test]
fn action_continuation_adds_new_structural_items_instead_of_navigation() {
    let reader = Workspace::new(&[
        (
            "check.md",
            "# Device training\n- Inspect training and validation loss.\n- Check training scales.\n- Verify training gradients.\n- Compare training baselines.\n\nUsed in [[Training]] and [[Validation]].",
        ),
        (
            "remedy.md",
            "# Device\nTraining loss improves while validation loss worsens when noise is memorized.\n\n## Remedies\n- Stop early.\n- Reduce capacity.",
        ),
    ]);
    let policy = AccessPolicy::default();
    let corpus = Corpus::build(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    let question = "What can I try when training loss improves but validation loss worsens?";
    let evidence = corpus.query(question, &reader, &policy);
    assert_eq!(
        evidence
            .iter()
            .filter(|e| e.path.as_str() == "check.md"
                && e.text.contains("Inspect training and validation loss."))
            .count(),
        1,
        "navigation-only extension must not repeat an already selected list"
    );
    assert!(
        evidence.iter().any(|e| e.path.as_str() == "remedy.md"
            && e.text.contains("Stop early.")
            && e.text.contains("Reduce capacity.")),
        "real remedies must remain available"
    );
    let model = Capture::default();
    let mut chat = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    chat.ask(question, &reader, &policy, &model, &Cancellation::default())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    assert!(
        model
            .0
            .lock()
            .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"))
            .iter()
            .flatten()
            .any(|e| e.text.contains("Stop early.") && e.text.contains("Reduce capacity."))
    );
    let calls = model
        .0
        .lock()
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    assert!(calls.len() <= 3);
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| synapse_core::verify_evidence(&reader, &policy, e))
    );
}
