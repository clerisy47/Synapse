use std::{
    error::Error,
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use synapse_adapters::CanonicalWorkspace;
use synapse_core::{
    AccessPolicy, Cancellation, ChatSession, ModelJob, ModelResult, ModelService, Priority,
    PublicError,
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Result<Self, Box<dyn Error>> {
        let path = std::env::temp_dir().join(format!(
            "synapse-chat-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path)?;
        fs::write(
            path.join("moon.md"),
            "---\ndescription: Moon fixture\ntags: [fixture]\naliases: []\n---\nThe synthetic moon orbits at 42 units.\n",
        )?;
        Ok(Self(path))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct Recorder {
    questions: Mutex<Vec<String>>,
    selection: usize,
}
impl ModelService for Recorder {
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let ModelJob::SelectEvidence { question, .. } = job else {
            return Err(PublicError::Usage);
        };
        self.questions
            .lock()
            .map_err(|_| PublicError::ProviderUnavailable)?
            .push(question);
        Ok(ModelResult::Selected(vec![self.selection]))
    }
}
#[test]
fn memory_keeps_three_turns_and_source_inspection_rechecks_bytes() -> Result<(), Box<dyn Error>> {
    let fixture = Fixture::new()?;
    let reader = CanonicalWorkspace::open(&fixture.0).map_err(|_| "root")?;
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone()).map_err(|_| "session")?;
    let model = Recorder {
        questions: Mutex::new(Vec::new()),
        selection: 1,
    };
    for question in [
        "moon first",
        "moon second",
        "moon third",
        "moon fourth",
        "moon fifth",
    ] {
        let answer = session
            .ask(question, &reader, &policy, &model, &Cancellation::default())
            .map_err(|_| "ask")?;
        assert_eq!(answer.sources.len(), 1);
        assert_eq!(
            answer.sources[0].text,
            "The synthetic moon orbits at 42 units."
        );
    }
    let questions = model.questions.lock().map_err(|_| "recorder")?;
    let context = questions.last().ok_or("no questions")?;
    assert!(!context.contains("moon first"));
    for question in ["moon second", "moon third", "moon fourth", "moon fifth"] {
        assert!(context.contains(question));
    }
    assert!(session.inspect(1, &reader, &policy).is_ok());
    fs::write(fixture.0.join("moon.md"), "changed")?;
    assert!(matches!(
        session.inspect(1, &reader, &policy),
        Err(PublicError::AccessRefused)
    ));
    Ok(())
}
#[test]
fn invalid_model_ids_cannot_become_sources_and_reset_discards_sources() -> Result<(), Box<dyn Error>>
{
    let fixture = Fixture::new()?;
    let reader = CanonicalWorkspace::open(&fixture.0).map_err(|_| "root")?;
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone()).map_err(|_| "session")?;
    let model = Recorder {
        questions: Mutex::new(Vec::new()),
        selection: 99,
    };
    assert!(matches!(
        session.ask("moon", &reader, &policy, &model, &Cancellation::default()),
        Err(PublicError::InvalidModelOutput)
    ));
    session.reset();
    assert!(session.inspect(1, &reader, &policy).is_err());
    Ok(())
}
#[test]
fn revoked_history_never_reaches_the_next_model_input() -> Result<(), Box<dyn Error>> {
    let fixture = Fixture::new()?;
    let reader = CanonicalWorkspace::open(&fixture.0).map_err(|_| "root")?;
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone()).map_err(|_| "session")?;
    let model = Recorder {
        questions: Mutex::new(Vec::new()),
        selection: 1,
    };
    assert!(
        session
            .ask("moon", &reader, &policy, &model, &Cancellation::default())
            .is_ok()
    );
    let revoked = AccessPolicy {
        tags: vec!["fixture".into()],
        ..policy
    };
    let answer = session
        .ask("moon", &reader, &revoked, &model, &Cancellation::default())
        .map_err(|_| "ask")?;
    assert!(!answer.sufficient());
    assert_eq!(model.questions.lock().map_err(|_| "recorder")?.len(), 1);
    Ok(())
}
struct Planner(Mutex<Vec<&'static str>>);
impl ModelService for Planner {
    fn execute(
        &self,
        job: ModelJob,
        _: Priority,
        _: &Cancellation,
    ) -> Result<ModelResult, PublicError> {
        let mut calls = self
            .0
            .lock()
            .map_err(|_| PublicError::ProviderUnavailable)?;
        match job {
            ModelJob::SearchTerms { .. } => {
                calls.push("plan");
                Ok(ModelResult::SearchTerms(vec!["moon".into()]))
            }
            ModelJob::SelectEvidence { .. } => {
                calls.push("select");
                Ok(ModelResult::Selected(vec![1]))
            }
            ModelJob::Health => Err(PublicError::Usage),
        }
    }
}
#[test]
fn bounded_search_planning_uses_literal_terms_when_initial_retrieval_is_empty()
-> Result<(), Box<dyn Error>> {
    let fixture = Fixture::new()?;
    let reader = CanonicalWorkspace::open(&fixture.0).map_err(|_| "root")?;
    let policy = AccessPolicy::default();
    let mut session = ChatSession::new(&reader, policy.clone()).map_err(|_| "session")?;
    let model = Planner(Mutex::new(Vec::new()));
    let answer = session
        .ask(
            "unmatched concept",
            &reader,
            &policy,
            &model,
            &Cancellation::default(),
        )
        .map_err(|_| "ask")?;
    assert!(answer.sufficient());
    assert_eq!(
        *model.0.lock().map_err(|_| "recorder")?,
        vec!["plan", "select"]
    );
    Ok(())
}
