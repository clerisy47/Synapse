//! Synthetic-only diagnostic checkpoint for T24. No production trace/log API.
#[path = "support/protocol.rs"]
mod protocol;
mod support;

use sha2::{Digest, Sha256};
use std::sync::Mutex;
use support::Workspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    NotePath, NoteReadPort, Priority, PublicError, verify_evidence,
};

#[derive(Default)]
struct Selector(Mutex<Vec<Vec<Evidence>>>);
impl ModelService for Selector {
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
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

fn covers(evidence: &[Evidence], facts: &[&str]) -> bool {
    facts
        .iter()
        .all(|fact| evidence.iter().any(|e| e.text.contains(fact)))
}

fn checkpoint(question: &str, body: &str, facts: &[&str], answerable: bool) {
    checkpoint_inner(question, body, facts, answerable, false);
}

fn crowded_checkpoint(question: &str, body: &str, facts: &[&str]) {
    checkpoint_inner(question, body, facts, true, true);
}

fn checkpoint_inner(question: &str, body: &str, facts: &[&str], answerable: bool, crowded: bool) {
    let noise: Vec<_> = (0..12).map(|i| (format!("distractor-{i}.md"),
        format!("# Related observation\n{} This separate observation concerns staffing review number {i}.", question.trim_end_matches('?')))).collect();
    let mut notes = vec![("renamed.md", body)];
    if crowded {
        notes.extend(
            noise
                .iter()
                .map(|(path, body)| (path.as_str(), body.as_str())),
        );
    }
    let reader = Workspace::new(&notes);
    let policy = AccessPolicy::default();
    let corpus =
        Corpus::build(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let context = format!("Latest question: {question}");
    let packets = corpus
        .query_packets_for_question(question, question, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let candidates = corpus
        .resolve_packets(&packets, &reader, &policy)
        .unwrap_or_else(|e| panic!("{e:?}"));
    let path = NotePath::parse("renamed.md").unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let local = corpus.query_note(&path, &context, &reader, &policy);
    // Oracle: the full source really contains every required fact. Candidate
    // loss must not be confused with an unanswerable fixture.
    let bytes = reader
        .read_note(&path)
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(facts.iter().all(|fact| bytes.contains(fact)));
    let source_hash = format!("{:x}", Sha256::digest(bytes.as_bytes()));
    let model = Selector::default();
    let mut chat =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = chat
        .ask(question, &reader, &policy, &model, &Cancellation::default())
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let batches = model.0.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!batches.is_empty(), "fixture must exercise selection");
    for batch in batches.iter() {
        assert!(batch.len() <= 16);
        for (index, source) in batch.iter().enumerate() {
            assert_eq!(source.id, index + 1);
            assert!(verify_evidence(&reader, &policy, source));
        }
    }
    assert!(
        candidates
            .iter()
            .chain(&local)
            .chain(&answer.sources)
            .all(|e| verify_evidence(&reader, &policy, e))
    );
    let spans = |items: &[Evidence]| {
        items
            .iter()
            .map(|e| (e.id, e.start_line, e.end_line))
            .collect::<Vec<_>>()
    };
    let attribution = format!(
        "sha256={source_hash}; candidates={:?}; note_local={:?}; packed={:?}; returned={:?}; candidate_coverage={}; local_coverage={}; packed_coverage={}; stop={}",
        spans(&candidates),
        spans(&local),
        batches.iter().map(|b| spans(b)).collect::<Vec<_>>(),
        spans(&answer.sources),
        covers(&candidates, facts),
        covers(&local, facts),
        batches.iter().any(|b| covers(b, facts)),
        if answer.sufficient() {
            "accepted"
        } else {
            "abstained"
        }
    );
    assert_eq!(
        answer.sufficient(),
        answerable,
        "support/status: {attribution}"
    );
    if answerable {
        assert!(
            covers(&answer.sources, facts),
            "missing required support: {attribution}"
        );
    }
}

#[test]
fn oracle_supported_negative_and_measured_zero_remain_answerable() {
    checkpoint(
        "Does completion measure correctness?",
        "# Completion\nCompletion does not measure correctness.",
        &["does not measure correctness"],
        true,
    );
    checkpoint(
        "What is the measured battery lifetime?",
        "# Battery\nThe measured battery lifetime is 0 hours.",
        &["0 hours"],
        true,
    );
    checkpoint(
        "How many failures were measured?",
        "# Measurement\nThe completed trial measured zero failures.",
        &["zero failures"],
        true,
    );
    checkpoint(
        "When is the trial planned?",
        "# Trial\nThe trial is planned for November.",
        &["November"],
        true,
    );
}

// Former red checkpoints are now enabled. Original semantic expectations are
// preserved; source packet inputs and complete coverage must both pass.
#[test]
fn missing_measurement_abstains() {
    checkpoint(
        "What is the battery lifetime?",
        "# Battery\nBattery lifetime was not measured. The device weighs 40 grams.",
        &[],
        false,
    );
}

#[test]
fn planned_improvement_abstains() {
    checkpoint(
        "Did the pilot improve throughput?",
        "# Pilot\nThe pilot plans to improve throughput in November. No trial has run.",
        &[],
        false,
    );
}

#[test]
fn unsupported_topic_abstains() {
    checkpoint(
        "What do the notes say about marine biology?",
        "# Field journal\nThere are no marine biology observations in this journal.",
        &[],
        false,
    );
}

#[test]
fn equality_exception_survives_renaming_relocation_and_value_changes() {
    for (subject, value) in [("Cedar", "2"), ("Willow", "7")] {
        let exception = format!("Exactly {value} percent remains eligible with warning.");
        let body = format!(
            "# {subject} quality\n{subject} quality quarantines batches above {value} percent.\n\n## Audit\nThe operator records the quality decision.\n\n## Boundary\n{exception}"
        );
        crowded_checkpoint(
            &format!("Does {subject} quarantine at exactly {value} percent?"),
            &body,
            &[&exception],
        );
    }
}

#[test]
fn duration_and_mitigation_both_survive() {
    crowded_checkpoint(
        "What was the Harbor incident duration and mitigation?",
        "# Harbor incident\nThe Harbor incident duration was 24 minutes.\n\n## Uncertainty\nThe Harbor incident mitigation has an uncertain long-term effect.\n\n## Intervention\nConcurrency was reduced from 20 to 4.",
        &["24 minutes", "20 to 4"],
    );
}

#[test]
fn comparison_retains_qualification() {
    crowded_checkpoint(
        "What changed between Orchard trials and what are the limits?",
        "# Orchard trials\nOrchard trial A used 20 degrees for six hours.\n\n## Trial B\nOrchard trial B used 24 degrees for four hours.\n\n## Interpretation\nChanging temperature and time together cannot isolate either effect.",
        &[
            "20 degrees",
            "six hours",
            "24 degrees",
            "four hours",
            "cannot isolate either effect",
        ],
    );
}

#[test]
fn compass_correctness_and_explicit_multipart_both_keep_complete_support() {
    let body = "# Compass example\nThe team completed 18 of 24 items, giving 75 percent completion.\n\n## Limitation\nCompletion does not measure correctness.";
    checkpoint(
        "Does Compass completion measure correctness?",
        body,
        &["does not measure correctness"],
        true,
    );
    checkpoint(
        "In the Compass example, how many items were completed out of the total and what completion percentage is that and does it measure correctness?",
        body,
        &["18 of 24", "75 percent", "does not measure correctness"],
        true,
    );
}

#[test]
fn absent_unrequested_observations_do_not_erase_a_recorded_value() {
    checkpoint(
        "What was the Ridge water budget?",
        "# Ridge trip\nRidge water budget was 30 liters.\n\nNo wildlife survey or marine observation was conducted.",
        &["30 liters"],
        true,
    );
    checkpoint(
        "What is the battery weight?",
        "# Battery\nBattery lifetime was not measured. The battery weight is 40 grams.",
        &["40 grams"],
        true,
    );
}
