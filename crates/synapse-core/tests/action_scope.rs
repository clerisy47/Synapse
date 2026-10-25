#[path = "support/protocol.rs"]
mod protocol;
mod support;

use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, ModelJob, ModelResult, ModelService, Priority,
    PublicError,
};

struct SelectCooling;
impl ModelService for SelectCooling {
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
                let ids: Vec<_> = evidence
                    .iter()
                    .filter(|source| {
                        source.text.contains("Improve ventilation")
                            && !source.text.contains("Replace printer toner")
                    })
                    .map(|source| source.id)
                    .collect();
                if ids.is_empty() {
                    Ok(ModelResult::InsufficientEvidence)
                } else {
                    Ok(ModelResult::Selected(ids))
                }
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["cooling".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

fn cooling(body: &str) -> bool {
    let reader = Workspace::new(&[("manual.md", body)]);
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("fixture: {error:?}"));
    session
        .ask(
            "What can I try when cooling fails?",
            &reader,
            &policy,
            &SelectCooling,
            &Cancellation::default(),
        )
        .unwrap_or_else(|error| panic!("fixture: {error:?}"))
        .sufficient()
}

const COOLING: &str = "# Cooling\nCooling fails under sustained load.\n## Mitigations\n- Reduce load.\n- Improve ventilation.";

#[test]
fn complete_relevant_remedies_are_supported() {
    assert!(cooling(COOLING));
}

#[test]
fn unrelated_sibling_topic_options_do_not_invalidate_complete_remedies() {
    let body = format!(
        "{COOLING}\n# Appendix\n{}\n# Printer\n## Options\n- Replace printer toner.",
        "Unrelated background text.\n".repeat(100)
    );
    assert!(cooling(&body));
}

#[test]
fn unrelated_nested_peer_options_do_not_invalidate_complete_remedies() {
    let relevant = COOLING
        .replace("# Cooling", "# Manual\n## Cooling")
        .replace("## Mitigations", "### Mitigations");
    let body = format!(
        "{relevant}\n## Appendix\n{}\n## Printer\n### Options\n- Replace printer toner.",
        "Unrelated background text.\n".repeat(100)
    );
    assert!(cooling(&body));
}
