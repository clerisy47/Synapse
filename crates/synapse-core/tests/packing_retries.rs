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
struct Capture(Mutex<Vec<Vec<Evidence>>>);
impl ModelService for Capture {
    fn execute(
        &self,
        job: ModelJob,
        priority: Priority,
        protocol_cancel: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        if let ModelJob::AssessEvidence {
            requirements,
            evidence,
            ..
        } = job
        {
            // A scripted provider packs whole ranges under a synthetic capacity.
            // Only served IDs count as attempted; the production allocator uses
            // actual rendered tokens, not this fixture's deterministic lengths.
            let mut remaining = 1400usize;
            let mut served = Vec::new();
            for item in evidence {
                if item.text.len() + 64 <= remaining {
                    remaining -= item.text.len() + 64;
                    served.push(item);
                }
            }
            if served.is_empty() {
                return Err(PublicError::ContextOverflow);
            }
            let served_ids = served.iter().map(|e| e.id).collect();
            self.0
                .lock()
                .unwrap_or_else(|e| panic!("{e:?}"))
                .push(served);
            return Ok(ModelResult::Assessment(synapse_core::Assessment {
                support: requirements
                    .iter()
                    .map(|r| synapse_core::RequirementSupport {
                        value_evidence_id: None,
                        basis: synapse_core::SupportBasis::Recorded,
                        id: r.id,
                        state: synapse_core::SupportState::MissingInformation,
                        evidence_ids: Vec::new(),
                    })
                    .collect(),
                served_ids,
                prompt_tokens: 1,
                completion_tokens: 1,
            }));
        }
        let job = match protocol::adapt(self, job, priority, protocol_cancel) {
            Ok(job) => job,
            Err(result) => return result,
        };

        match job {
            ModelJob::SelectEvidence { evidence, .. } => {
                self.0
                    .lock()
                    .unwrap_or_else(|e| panic!("fixture: {e:?}"))
                    .push(evidence);
                Ok(ModelResult::InsufficientEvidence)
            }
            ModelJob::SearchTerms { .. } => Ok(ModelResult::SearchTerms(vec!["fixture".into()])),
            _ => Err(PublicError::InvalidModelOutput),
        }
    }
}

#[test]
fn skipped_large_passage_precedes_served_passages_on_next_attempt() {
    let body = |size: usize| {
        format!(
            "# Topic\nTopic describes a synthetic measurement. {}",
            "x".repeat(size - 40)
        )
    };
    let bodies = [
        body(450),
        body(450).replace("measurement.", "measurement!"),
        body(500),
        body(100),
    ];
    let notes: Vec<_> = ["a.md", "b.md", "c.md", "d.md"]
        .into_iter()
        .zip(bodies.iter().map(String::as_str))
        .collect();
    let reader = Workspace::new(&notes);
    let policy = AccessPolicy::default();
    let model = Capture::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let answer = session
        .ask(
            "What does topic describe?",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(!answer.sufficient());
    let calls = model.0.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!(
        (2..=6).contains(&calls.len()),
        "unserved candidate must receive a retry"
    );
    let first: Vec<_> = calls[0].iter().map(|e| e.path.as_str()).collect();
    assert_eq!(
        first,
        ["a.md", "b.md", "d.md"],
        "fixture must exercise a packing gap before later small evidence"
    );
    assert_eq!(
        calls[1][0].path.as_str(),
        "c.md",
        "unserved large passage must precede already attempted passages"
    );
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| verify_evidence(&reader, &policy, e))
    );
    for batch in calls.iter() {
        assert!(batch.len() <= 16);
        for source in batch {
            assert!(source.id > 0 && source.id <= 192);
        }
    }
}

#[test]
fn retry_identity_distinguishes_two_passages_of_the_same_note() {
    let paragraph = |size: usize| {
        format!(
            "Topic describes a synthetic measurement. {}",
            "x".repeat(size - 40)
        )
    };
    let a = format!(
        "# Topic\n{}\n\n## Detail\n{}",
        paragraph(800),
        paragraph(800)
    );
    let b = format!("# Topic\n{}", paragraph(450));
    let d = format!("# Topic\n{}", paragraph(100));
    let reader = Workspace::new(&[("a.md", &a), ("b.md", &b), ("d.md", &d)]);
    let policy = AccessPolicy::default();
    let model = Capture::default();
    let mut session =
        ChatSession::new(&reader, policy.clone()).unwrap_or_else(|e| panic!("fixture: {e:?}"));
    session
        .ask(
            "What does topic describe?",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .unwrap_or_else(|e| panic!("fixture: {e:?}"));
    let calls = model.0.lock().unwrap_or_else(|e| panic!("fixture: {e:?}"));
    assert!((2..=6).contains(&calls.len()));
    assert_eq!(calls[0][0].path.as_str(), "a.md");
    assert_eq!(calls[1][0].path.as_str(), "a.md");
    assert!(
        calls[1][0].start_line > calls[0][0].end_line,
        "unserved later passage shares a path but must remain a distinct candidate"
    );
    assert_ne!(
        calls[0][0].id, calls[1][0].id,
        "distinct ranges keep distinct query IDs"
    );
    assert!(
        calls
            .iter()
            .flatten()
            .all(|e| verify_evidence(&reader, &policy, e))
    );
}
