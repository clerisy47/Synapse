#[path = "support/protocol.rs"]
mod protocol;
mod support;

use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, ModelJob, ModelResult, ModelService, Priority,
    PublicError,
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
                "churn".into(),
                "logistic".into(),
                "forests".into(),
            ])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

fn sufficient(question: &str, body: &str) -> bool {
    let reader = Workspace::new(&[("note.md", body)]);
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone())
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"));
    session
        .ask(
            question,
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|error| panic!("synthetic fixture: {error:?}"))
        .sufficient()
}

#[test]
fn dates_and_counts_do_not_become_measured_accuracy() {
    for body in [
        "The churn experiment has never measured test accuracy as of 2026.",
        "The churn experiment accuracy remains unmeasured in 2026.",
        "The churn experiment has 92 samples; accuracy remains unknown.",
        "The churn experiment accuracy was planned in 2026.",
        "The churn experiment has not achieved accuracy of 92 percent.",
    ] {
        assert!(
            !sufficient(
                "What was the churn experiment's measured test accuracy?",
                body
            ),
            "accepted unsupported measurement: {body}"
        );
    }
}

#[test]
fn explicit_measured_accuracy_values_remain_supported() {
    for body in [
        "The churn experiment measured test accuracy of 0.91 on held-out examples.",
        "The churn experiment achieved test accuracy of 92 percent.",
        "The churn experiment reported test accuracy: 92%.",
        "[[Churn experiment]] achieved test accuracy of 92 percent.",
        "[Churn experiment](project.md) achieved test accuracy of 92 percent.",
    ] {
        assert!(
            sufficient(
                "What was the churn experiment's measured test accuracy?",
                body
            ),
            "rejected measured value: {body}"
        );
    }
}

#[test]
fn linked_sentence_subjects_support_comparisons() {
    for body in [
        "[[Logistic regression]] uses a linear boundary and a configurable threshold.\n[[Random forests]] capture nonlinear interactions.",
        "[[Linear model|Logistic regression]] uses a linear boundary and a configurable threshold.\n[[Ensemble|Random forests]] capture nonlinear interactions.",
        "[Logistic regression](linear.md) uses a linear boundary and a configurable threshold.\n[Random forests](ensemble.md) capture nonlinear interactions.",
    ] {
        assert!(
            sufficient(
                "Compare logistic regression and random forests for churn.",
                body
            ),
            "rejected factual links: {body}"
        );
    }
}

#[test]
fn discovery_links_cannot_supply_comparison_subjects() {
    for body in [
        "[[Logistic regression]] [[Random forests]]",
        "[Logistic regression](linear.md) [Random forests](ensemble.md)",
        "See [[Logistic regression]] and [[Random forests]].",
        "Related: [[Logistic regression]] and [[Random forests]].",
        "Relevant sources: [[Logistic regression]] and [[Random forests]].",
        "| Compare logistic regression and random forests for churn. | [[Logistic regression]] [[Random forests]] |",
        "The model uses a linear boundary. See [[Logistic regression]] and [[Random forests]].",
        "[[Logistic regression|Linear model]] uses a linear boundary.\n[[Random forests|Ensemble]] capture nonlinear interactions.",
        "[Linear model](logistic-regression.md) uses a linear boundary.\n[Ensemble](random-forests.md) capture nonlinear interactions.",
    ] {
        assert!(
            !sufficient(
                "Compare logistic regression and random forests for churn.",
                body
            ),
            "accepted discovery-only subjects: {body}"
        );
    }
}

#[test]
fn accuracy_tables_and_per_cent_values_remain_supported() {
    for body in [
        "| Metric | Value |\n| --- | --- |\n| Churn experiment test accuracy | 0.83 |",
        "The churn experiment test accuracy was 83 per cent.",
    ] {
        assert!(
            sufficient(
                "What was the churn experiment's measured test accuracy?",
                body
            ),
            "rejected recorded value: {body}"
        );
    }
}

#[test]
fn planned_accuracy_is_not_an_observed_result() {
    for body in [
        "The churn experiment planned test accuracy of 0.91.",
        "The churn experiment target accuracy was 91 percent.",
    ] {
        assert!(
            !sufficient(
                "What was the churn experiment's measured test accuracy?",
                body
            ),
            "accepted planned result: {body}"
        );
    }
}

#[test]
fn another_clause_cannot_supply_measurement_subject() {
    for body in [
        "Weather accuracy was 0.91; the churn experiment measured 200 accounts.",
        "Weather accuracy was 0.91. The churn experiment measured 200 accounts.",
    ] {
        assert!(
            !sufficient(
                "What was the churn experiment's measured test accuracy?",
                body
            ),
            "borrowed unrelated subject: {body}"
        );
    }
}

#[test]
fn bookmarks_are_navigation_rather_than_comparison_facts() {
    assert!(!sufficient(
        "Compare logistic regression and random forests for churn.",
        "I bookmarked [[Logistic regression]] and [[Random forests]]."
    ));
}

#[test]
fn later_accuracy_field_in_the_same_clause_can_supply_the_value() {
    assert!(sufficient(
        "What was the churn experiment's measured test accuracy?",
        "The churn experiment evaluated accuracy and achieved test accuracy of 0.91."
    ));
}

#[test]
fn planned_link_navigation_does_not_supply_comparison_properties() {
    let reader = Workspace::new(&[
        (
            "plan.md",
            "# Model comparison\nStart with [[Linear Predictor]], then compare [[Tree Ensemble]]. Report precision and recall.",
        ),
        ("linear.md", "Linear Predictor uses a linear boundary."),
    ]);
    let policy = AccessPolicy::default();
    let mut chat = ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("{e:?}"));
    let answer = chat
        .ask(
            "Compare Linear Predictor and Tree Ensemble",
            &reader,
            &policy,
            &SelectAll,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("{e:?}"));
    assert!(!answer.sufficient());
}
