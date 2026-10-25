#[path = "support/protocol.rs"]
mod protocol;
mod support;

use std::sync::Mutex;
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    Priority, PublicError, verify_evidence,
};

#[derive(Default)]
struct SelectTable(Mutex<Vec<Vec<Evidence>>>);
impl ModelService for SelectTable {
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
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["cooling".into()])),
            ModelJob::SelectEvidence { evidence, .. } => {
                let ids = evidence.iter().map(|e| e.id).collect();
                self.0
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                    .push(evidence);
                Ok(ModelResult::Selected(ids))
            }
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn table_headers_do_not_turn_repeated_question_and_navigation_into_remedies() {
    let question = "What can I try when cooling fails?";
    for (header, separator, row) in [
        (
            "| Prompt | Sources |",
            "| --- | --- |",
            format!("| {question} | [[Cooling]] |"),
        ),
        (
            "| Inquiry | References |",
            "| :--- | ---: |",
            format!("| {question} | [[Cooling]] |"),
        ),
        (
            "Inquiry | References",
            ":---: | ---",
            format!("{question} | [[Cooling]]"),
        ),
        (
            "| Inquiry | References",
            "| --- | :---:",
            format!("| {question} | [[Cooling]]"),
        ),
    ] {
        let body = format!("{header}\n{separator}\n{row}\n");
        let reader = Workspace::new(&[("neutral.md", &body)]);
        let policy = AccessPolicy::default();
        let model = SelectTable::default();
        let mut session =
            ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
        let answer = session
            .ask(question, &reader, &policy, &model, &Cancellation::default())
            .unwrap_or_else(|e| panic!("fixture: {e:?}"));
        assert!(
            !answer.sufficient(),
            "table structure is not evidence for a remedy"
        );
        assert!(answer.sources.is_empty());
        assert!(
            model
                .0
                .lock()
                .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                .iter()
                .flatten()
                .all(|e| verify_evidence(&reader, &policy, e))
        );
    }
}

#[test]
fn table_data_values_remain_authentic_support() {
    let body = "# Sensor measurements\n| Sensor | Pressure |\n| --- | --- |\n| Synthetic sensor | 47 kPa |\n";
    let reader = Workspace::new(&[("neutral.md", body)]);
    let policy = AccessPolicy::default();
    let model = SelectTable::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "How much pressure did the synthetic sensor record?",
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
            .any(|e| e.text.contains("| Synthetic sensor | 47 kPa |")
                && verify_evidence(&reader, &policy, e))
    );
}

#[test]
fn header_only_navigation_is_weak_search_discovery_not_factual_retrieval() {
    let question = "What can I try when cooling fails?";
    let body = format!("| Arbitrary | Labels |\n| :---: | ---: |\n| {question} | [[Cooling]] |\n");
    let reader = Workspace::new(&[("neutral.md", &body)]);
    let policy = AccessPolicy::default();
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(corpus.query(question, &reader, &policy).is_empty());
    let discovery = corpus.search("cooling", &reader, &policy);
    assert!(!discovery.is_empty());
    assert!(
        discovery
            .iter()
            .all(|e| verify_evidence(&reader, &policy, e))
    );
}

#[test]
fn measured_accuracy_in_header_without_a_data_row_is_not_a_result() {
    let reader = Workspace::new(&[(
        "neutral.md",
        "| Churn experiment test accuracy | 0.83 |\n| --- | --- |",
    )]);
    let policy = AccessPolicy::default();
    let model = SelectTable::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "What was the churn experiment measured test accuracy?",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!answer.sufficient());
    assert!(answer.sources.is_empty());
}

#[test]
fn prose_and_hyphens_without_a_table_separator_remain_factual() {
    for body in [
        "Cooling requires ventilation.\n---",
        "Cooling | ventilation remains necessary.\n---",
    ] {
        let reader = Workspace::new(&[("neutral.md", body)]);
        let policy = AccessPolicy::default();
        let model = SelectTable::default();
        let mut session =
            ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
        let answer = session
            .ask(
                "What does cooling require?",
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
                .any(|e| e.text.contains("ventilation") && verify_evidence(&reader, &policy, e))
        );
    }
}
