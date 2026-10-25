#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::sync::Mutex;
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Evidence, ModelJob, ModelResult, ModelService,
    Priority, PublicError, verify_evidence,
};

const OLD_QUESTION: &str = "What is the OLD_QUESTION_SENTINEL moon orbital period?";
const CURRENT_QUESTION: &str = "What can I try when chamber pressure rises?";
const REMEDIES: &str = "# Chamber pressure\nChamber pressure rises when the regulator drifts.\n\n## Remedies\n- Reset the chamber regulator.\n- Inspect the chamber seal.";

#[derive(Default)]
struct Seen {
    plans: Vec<String>,
    selections: Vec<(String, Vec<Evidence>)>,
}
#[derive(Default)]
struct Model {
    seen: Mutex<Seen>,
    fail_planning: bool,
}
impl ModelService for Model {
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

        let mut seen = self
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        match job {
            ModelJob::SearchTerms { question } => {
                seen.plans.push(question);
                if self.fail_planning {
                    Err(PublicError::ProviderUnavailable)
                } else {
                    Ok(ModelResult::SearchTerms(vec!["chamber pressure".into()]))
                }
            }
            ModelJob::SelectEvidence { question, evidence } => {
                let ids = evidence.iter().map(|e| e.id).collect();
                seen.selections.push((question, evidence));
                Ok(ModelResult::Selected(ids))
            }
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn actionable_planning_discards_history_whose_evidence_is_ignored_or_changed() {
    for ignore_old in [true, false] {
        let mut reader = Workspace::new(&[
            (
                "moon.md",
                "# Moon\nThe moon orbital period is 23 days. OLD_NOTE_SENTINEL.",
            ),
            ("chamber.md", REMEDIES),
            (
                "excluded.md",
                "# Chamber pressure\nEXCLUDED_NOTE_SENTINEL is confidential.",
            ),
        ]);
        // A real metadata exclusion, rather than a suggestive fixture filename.
        reader.notes[2].1 = reader.notes[2].1.replace(
            "aliases: []\n---",
            "aliases: []\nvault-synapse: ignore\n---",
        );
        let policy = AccessPolicy::default();
        let mut chat =
            ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
        let initial = Model::default();
        let answer = chat
            .ask(
                OLD_QUESTION,
                &reader,
                &policy,
                &initial,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert!(answer.sufficient());
        assert!(
            answer
                .sources
                .iter()
                .any(|e| e.path.as_str() == "moon.md" && e.text.contains("OLD_NOTE_SENTINEL"))
        );
        assert!(
            answer
                .sources
                .iter()
                .all(|e| verify_evidence(&reader, &policy, e))
        );
        assert_eq!(
            initial
                .seen
                .lock()
                .unwrap_or_else(|e| panic!("{e:?}"))
                .plans
                .len(),
            1
        );

        if ignore_old {
            reader.notes[0].1 = reader.notes[0].1.replace(
                "aliases: []\n---",
                "aliases: []\nvault-synapse: ignore\n---",
            );
        } else {
            reader.notes[0].1 = reader.notes[0].1.replace("23 days", "31 days");
        }
        let model = Model::default();
        let answer = chat
            .ask(
                CURRENT_QUESTION,
                &reader,
                &policy,
                &model,
                &Cancellation::default(),
            )
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert!(answer.sufficient());
        assert!(
            answer
                .sources
                .iter()
                .any(|e| e.path.as_str() == "chamber.md"
                    && e.text.contains("Reset the chamber regulator.")
                    && e.text.contains("Inspect the chamber seal."))
        );
        assert!(
            answer
                .sources
                .iter()
                .all(|e| verify_evidence(&reader, &policy, e))
        );
        let seen = model
            .seen
            .lock()
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert_eq!(seen.plans, [format!("Latest question: {CURRENT_QUESTION}")]);
        assert!(!seen.selections.is_empty() && seen.plans.len() + seen.selections.len() <= 3);
        for (question, evidence) in &seen.selections {
            assert_eq!(question, &seen.plans[0]);
            assert!(
                !question.contains("OLD_QUESTION_SENTINEL")
                    && !question.contains("OLD_NOTE_SENTINEL")
                    && !question.contains("EXCLUDED_NOTE_SENTINEL")
            );
            assert!(evidence.iter().all(|e| verify_evidence(&reader, &policy, e)
                && e.path.as_str() != "excluded.md"
                && !e.text.contains("EXCLUDED_NOTE_SENTINEL")));
            if ignore_old {
                assert!(evidence.iter().all(|e| e.path.as_str() != "moon.md"));
            }
        }
    }
}

#[test]
fn unavailable_action_planner_preserves_provider_error_without_lexical_fallback() {
    let reader = Workspace::new(&[("chamber.md", REMEDIES)]);
    let policy = AccessPolicy::default();
    let mut chat =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let model = Model {
        fail_planning: true,
        ..Model::default()
    };
    let result = chat.ask(
        CURRENT_QUESTION,
        &reader,
        &policy,
        &model,
        &Cancellation::default(),
    );
    assert!(matches!(result, Err(PublicError::ProviderUnavailable)));
    let seen = model
        .seen
        .lock()
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert_eq!(seen.plans, [format!("Latest question: {CURRENT_QUESTION}")]);
    assert!(seen.selections.is_empty());
}
