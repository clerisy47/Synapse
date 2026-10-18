use crate::{Corpus, EvidenceId, JobPriority, JobQueue, Passage};
use std::collections::VecDeque;
use synapse_core::{
    Cancellation, Clock, CorpusError, CorpusPolicy, CorpusReadPort, ModelError, ModelLeasePort,
    ModelRequest, ModelResponse, ModelTransport, Provider, RetrievalDecision,
};

pub use synapse_core::{
    MAX_CANDIDATE_PASSAGES as MAX_PASSAGES, MAX_CONTEXT_TURNS as MAX_TURNS, MAX_PASSAGE_BYTES,
    MAX_QUESTION_BYTES,
};
pub const MAX_MODEL_CALLS: usize = 3;
pub const MAX_READS: usize = 24;
const MAX_SEED_HITS: usize = 3;
const MAX_LINKS_PER_HIT: usize = 2;
const MAX_QUERY_TERMS: usize = 16;
pub const CHAT_DEADLINE_MS: u64 = 180_000;
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChatError {
    Model(ModelError),
    Corpus(CorpusError),
    Input,
}
impl ChatError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Model(e) => e.code(),
            Self::Input => "USAGE",
            Self::Corpus(CorpusError::Limit) => "CORPUS_LIMIT",
            Self::Corpus(CorpusError::Stale) => "EVIDENCE_STALE",
            Self::Corpus(_) => "WORKSPACE_ACCESS",
        }
    }
    pub fn exit_code(self) -> u8 {
        match self {
            Self::Model(ModelError::Cancelled) => 130,
            Self::Model(ModelError::Consent) => 3,
            Self::Model(ModelError::Configuration) | Self::Input => 2,
            Self::Corpus(CorpusError::Stale | CorpusError::Policy) => 3,
            _ => 1,
        }
    }
}
impl From<CorpusError> for ChatError {
    fn from(e: CorpusError) -> Self {
        Self::Corpus(e)
    }
}
impl From<ModelError> for ChatError {
    fn from(e: ModelError) -> Self {
        Self::Model(e)
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Answer {
    pub sources: Vec<Passage>,
}
impl Answer {
    pub fn supported(&self) -> bool {
        !self.sources.is_empty()
    }
}
#[derive(Clone)]
pub struct SessionOptions {
    pub policy: CorpusPolicy,
    pub provider: Provider,
}
impl Default for SessionOptions {
    fn default() -> Self {
        Self {
            policy: CorpusPolicy::default(),
            provider: Provider::bonsai(),
        }
    }
}
pub trait ChatPort {
    fn ask(&mut self, question: &str, cancel: &Cancellation) -> Result<Answer, ChatError>;
    fn search(&mut self, query: &str, cancel: &Cancellation) -> Result<Answer, ChatError>;
    fn source(&mut self, ordinal: usize) -> Result<Passage, ChatError>;
}
pub trait SessionFactory {
    fn open(
        &self,
        canonical_root: &str,
        options: SessionOptions,
    ) -> Result<Box<dyn ChatPort>, ChatError>;
}
struct Turn {
    question: String,
    ids: Vec<EvidenceId>,
}
pub struct ChatSession<R, C> {
    corpus: Corpus<R>,
    transport: Box<dyn ModelTransport>,
    lease: Box<dyn ModelLeasePort>,
    clock: C,
    queue: JobQueue,
    provider: Provider,
    history: VecDeque<Turn>,
    last: Vec<EvidenceId>,
}
impl<R: CorpusReadPort, C: Clock> ChatSession<R, C> {
    pub fn new(
        corpus: Corpus<R>,
        transport: Box<dyn ModelTransport>,
        lease: Box<dyn ModelLeasePort>,
        clock: C,
        provider: Provider,
    ) -> Self {
        Self {
            corpus,
            transport,
            lease,
            clock,
            queue: JobQueue::default(),
            provider,
            history: VecDeque::new(),
            last: Vec::new(),
        }
    }
    pub fn set_policy(&mut self, policy: CorpusPolicy) -> Result<(), ChatError> {
        self.clear();
        self.corpus.set_policy(policy)?;
        Ok(())
    }
    fn clear(&mut self) {
        self.history.clear();
        self.last.clear();
    }
    fn refresh(&mut self) -> Result<(), ChatError> {
        if self.corpus.refresh()? {
            self.clear();
        }
        Ok(())
    }
    fn boundary(&mut self, ids: &[EvidenceId]) -> Result<Vec<Passage>, ChatError> {
        ids.iter()
            .map(|id| self.corpus.resolve(id).map_err(ChatError::from))
            .collect()
    }
    fn collect(
        &mut self,
        query: &str,
        ids: &mut Vec<EvidenceId>,
        reads: &mut usize,
    ) -> Result<(), ChatError> {
        if *reads >= MAX_READS {
            return Ok(());
        }
        let hits = self.corpus.search(query)?;
        let mut candidates = Vec::new();
        for hit in hits.into_iter().take(MAX_SEED_HITS) {
            candidates.extend(self.corpus.context(&hit.evidence)?);
            for path in self
                .corpus
                .links(&hit.path)?
                .into_iter()
                .chain(self.corpus.backlinks(&hit.path)?)
                .take(MAX_LINKS_PER_HIT)
            {
                if let Some(id) = self.corpus.first_passage(&path)? {
                    candidates.push(id);
                }
            }
        }
        self.boundary(ids)?;
        candidates.extend(ids.iter().cloned());
        ids.clear();
        let mut bytes = 0;
        for id in candidates {
            if ids.contains(&id) {
                continue;
            }
            if *reads >= MAX_READS || ids.len() >= MAX_PASSAGES {
                break;
            }
            *reads += 1;
            let passage = self.corpus.resolve(&id)?;
            if bytes + passage.text.len() > MAX_PASSAGE_BYTES {
                continue;
            }
            bytes += passage.text.len();
            ids.push(id);
        }
        Ok(())
    }
    fn ask_inner(&mut self, question: &str, cancel: &Cancellation) -> Result<Answer, ChatError> {
        if question.trim().is_empty() || question.len() > MAX_QUESTION_BYTES {
            return Err(ChatError::Input);
        }
        self.refresh()?;
        let started = self.clock.milliseconds();
        let mut ids = Vec::new();
        let mut reads = 0;
        // Retained answers are candidates only after current access/byte checks.
        for turn in &self.history {
            for id in &turn.ids {
                if !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
        }
        ids.truncate(MAX_PASSAGES);
        self.collect(&seed(question), &mut ids, &mut reads)?;
        for _ in 0..MAX_MODEL_CALLS {
            if cancel.is_cancelled() {
                return Err(ModelError::Cancelled.into());
            }
            if self.clock.milliseconds().saturating_sub(started) >= CHAT_DEADLINE_MS {
                return Err(ModelError::Timeout.into());
            }
            let passages = self.boundary(&ids)?;
            let history = self
                .history
                .iter()
                .map(|turn| turn.question.clone())
                .collect();
            let request = ModelRequest::retrieve(
                self.provider.clone(),
                question,
                history,
                passages.iter().map(|p| p.text.clone()).collect(),
            )?;
            let response = self.queue.run(
                self.transport.as_ref(),
                self.lease.as_ref(),
                &request,
                JobPriority::Interactive,
                cancel,
            )?;
            if self.clock.milliseconds().saturating_sub(started) >= CHAT_DEADLINE_MS {
                return Err(ModelError::Timeout.into());
            }
            // Never release a model result derived from stale/excluded inputs.
            self.boundary(&ids)?;
            match response {
                ModelResponse::Retrieval(RetrievalDecision::Supported(selected)) => {
                    RetrievalDecision::supported(selected.clone(), ids.len())?;
                    let chosen: Vec<_> = selected.iter().map(|i| ids[*i].clone()).collect();
                    let answer = Answer {
                        sources: self.boundary(&chosen)?,
                    };
                    self.last = chosen.clone();
                    self.remember(question, chosen);
                    return Ok(answer);
                }
                ModelResponse::Retrieval(RetrievalDecision::Search(terms)) => {
                    RetrievalDecision::search(terms.clone())?;
                    for term in terms {
                        self.collect(&term, &mut ids, &mut reads)?;
                    }
                }
                ModelResponse::Retrieval(RetrievalDecision::Insufficient) => break,
                _ => return Err(ModelError::Format.into()),
            }
        }
        self.last.clear();
        self.remember(question, Vec::new());
        Ok(Answer {
            sources: Vec::new(),
        })
    }
    fn remember(&mut self, question: &str, ids: Vec<EvidenceId>) {
        if self.history.len() >= MAX_TURNS {
            self.history.pop_front();
        }
        self.history.push_back(Turn {
            question: question.to_owned(),
            ids,
        });
        while self.history.len() > MAX_TURNS {
            self.history.pop_front();
        }
    }
}
impl<R: CorpusReadPort, C: Clock> ChatPort for ChatSession<R, C> {
    fn ask(&mut self, question: &str, cancel: &Cancellation) -> Result<Answer, ChatError> {
        let result = self.ask_inner(question, cancel);
        if result.is_err() {
            self.clear();
        }
        result
    }
    fn search(&mut self, query: &str, cancel: &Cancellation) -> Result<Answer, ChatError> {
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled.into());
        }
        self.refresh()?;
        let hits = self.corpus.search(query)?;
        let ids: Vec<_> = hits
            .into_iter()
            .take(MAX_PASSAGES)
            .map(|h| h.evidence)
            .collect();
        let answer = Answer {
            sources: self.boundary(&ids)?,
        };
        self.last = ids;
        Ok(answer)
    }
    fn source(&mut self, ordinal: usize) -> Result<Passage, ChatError> {
        let id = self
            .last
            .get(ordinal.checked_sub(1).ok_or(ChatError::Input)?)
            .ok_or(ChatError::Input)?
            .clone();
        let result = self.corpus.resolve(&id).map_err(ChatError::from);
        if result.is_err() {
            self.clear();
        }
        result
    }
}
fn seed(question: &str) -> String {
    question
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|s| !s.is_empty())
        .filter(|s| {
            ![
                "what", "is", "the", "a", "an", "of", "in", "and", "to", "how", "does", "it",
            ]
            .contains(&s.to_ascii_lowercase().as_str())
        })
        .take(MAX_QUERY_TERMS)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use synapse_core::{ModelLease, ModelTask, NotePath, Scan, parse_document};
    type Notes = Arc<Mutex<Vec<(NotePath, String)>>>;
    struct Reader(Notes);
    impl CorpusReadPort for Reader {
        fn scan(&self, policy: &CorpusPolicy) -> Result<Scan, CorpusError> {
            let mut scan = Scan::default();
            for (path, text) in self.0.lock().unwrap_or_else(|_| panic!("fixture")).iter() {
                match parse_document(path.clone(), text, policy) {
                    Ok(Some(doc)) => scan.documents.push(doc),
                    Ok(None) => {}
                    Err(attention) => scan.attention.push(attention),
                }
            }
            Ok(scan)
        }
    }
    struct Guard;
    impl ModelLease for Guard {}
    struct Lease;
    impl ModelLeasePort for Lease {
        fn acquire(&self, _: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError> {
            Ok(Box::new(Guard))
        }
    }
    struct Time;
    impl Clock for Time {
        fn milliseconds(&self) -> u64 {
            0
        }
    }
    type Observed = Arc<Mutex<Vec<(usize, Vec<String>)>>>;
    struct Transport {
        decisions: Mutex<VecDeque<RetrievalDecision>>,
        observed: Observed,
        mutate: Option<Notes>,
        cancel: bool,
    }
    impl ModelTransport for Transport {
        fn complete(
            &self,
            request: &ModelRequest,
            token: &Cancellation,
        ) -> Result<ModelResponse, ModelError> {
            let ModelTask::Retrieve {
                history, passages, ..
            } = request.task()
            else {
                return Err(ModelError::Format);
            };
            self.observed
                .lock()
                .unwrap_or_else(|_| panic!("fixture"))
                .push((history.len(), passages.clone()));
            if let Some(notes) = &self.mutate {
                notes.lock().unwrap_or_else(|_| panic!("fixture"))[0].1 =
                    note("hidden", "EXCLUDED_REPLACEMENT");
            }
            if self.cancel {
                token.cancel();
            }
            Ok(ModelResponse::Retrieval(
                self.decisions
                    .lock()
                    .unwrap_or_else(|_| panic!("fixture"))
                    .pop_front()
                    .unwrap_or(RetrievalDecision::Insufficient),
            ))
        }
    }
    fn note(tags: &str, body: &str) -> String {
        format!("---\ndescription: synthetic\ntags: [{tags}]\naliases: []\n---\n{body}\n")
    }
    fn fixture(
        decisions: Vec<RetrievalDecision>,
        mutation: bool,
        cancel: bool,
    ) -> (ChatSession<Reader, Time>, Notes, Observed) {
        let notes = Arc::new(Mutex::new(vec![(
            NotePath::parse("lighthouse.md").unwrap_or_else(|_| panic!("fixture")),
            note("public", "The lighthouse is Aurora."),
        )]));
        let observed = Arc::new(Mutex::new(Vec::new()));
        let policy = CorpusPolicy::new(
            vec![
                NotePath::parse("Synapse/Instructions.md").unwrap_or_else(|_| panic!("fixture")),
                NotePath::parse("Research.md").unwrap_or_else(|_| panic!("fixture")),
            ],
            vec![],
            vec!["hidden".into()],
            synapse_core::Limits::default(),
        )
        .unwrap_or_else(|_| panic!("fixture"));
        let transport = Transport {
            decisions: Mutex::new(decisions.into()),
            observed: observed.clone(),
            mutate: mutation.then(|| notes.clone()),
            cancel,
        };
        (
            ChatSession::new(
                Corpus::new(Reader(notes.clone()), policy),
                Box::new(transport),
                Box::new(Lease),
                Time,
                Provider::bonsai(),
            ),
            notes,
            observed,
        )
    }
    #[test]
    fn bounded_multistep_retrieval_returns_only_resolved_body_with_coordinates() {
        let (mut chat, _, observed) = fixture(
            vec![
                RetrievalDecision::Search(vec!["lighthouse".into()]),
                RetrievalDecision::Supported(vec![0]),
            ],
            false,
            false,
        );
        let answer = chat
            .ask("What is the project codename?", &Cancellation::default())
            .unwrap_or_else(|_| panic!("answer"));
        assert_eq!(answer.sources[0].text, "The lighthouse is Aurora.");
        assert_eq!(answer.sources[0].start_line, 6);
        assert_eq!(
            observed.lock().unwrap_or_else(|_| panic!("fixture")).len(),
            2
        );
        assert_eq!(chat.source(1), Ok(answer.sources[0].clone()));
    }
    #[test]
    fn three_turn_context_is_bounded_and_current_exclusion_invalidates_history_and_sources() {
        let (mut chat, notes, observed) =
            fixture(vec![RetrievalDecision::Supported(vec![0]); 5], false, false);
        for q in [
            "lighthouse one",
            "lighthouse two",
            "lighthouse three",
            "lighthouse four",
            "What about it?",
        ] {
            assert!(
                chat.ask(q, &Cancellation::default())
                    .unwrap_or_else(|_| panic!("answer"))
                    .supported()
            );
        }
        let counts: Vec<_> = observed
            .lock()
            .unwrap_or_else(|_| panic!("fixture"))
            .iter()
            .map(|(n, _)| *n)
            .collect();
        assert_eq!(counts, vec![0, 1, 2, 3, 3]);
        notes.lock().unwrap_or_else(|_| panic!("fixture"))[0].1 =
            note("hidden", "EXCLUDED_AFTER_TURN");
        assert_eq!(chat.source(1), Err(ChatError::Corpus(CorpusError::Stale)));
        assert!(chat.history.is_empty());
        assert!(
            !chat
                .ask("lighthouse", &Cancellation::default())
                .unwrap_or_else(|_| panic!("answer"))
                .supported()
        );
        assert!(
            observed
                .lock()
                .unwrap_or_else(|_| panic!("fixture"))
                .last()
                .is_some_and(|(n, p)| *n == 0 && p.is_empty())
        );
    }
    #[test]
    fn stale_model_inputs_unknown_ids_and_cancellation_never_release_answers() {
        let (mut chat, _, _) = fixture(vec![RetrievalDecision::Supported(vec![0])], true, false);
        assert_eq!(
            chat.ask("lighthouse", &Cancellation::default()),
            Err(ChatError::Corpus(CorpusError::Stale))
        );
        let (mut chat, _, _) = fixture(vec![RetrievalDecision::Supported(vec![999])], false, false);
        assert_eq!(
            chat.ask("lighthouse", &Cancellation::default()),
            Err(ChatError::Model(ModelError::Format))
        );
        let (mut chat, _, _) = fixture(vec![RetrievalDecision::Supported(vec![0])], false, true);
        assert_eq!(
            chat.ask("lighthouse", &Cancellation::default()),
            Err(ChatError::Model(ModelError::Cancelled))
        );
        assert!(chat.last.is_empty());
    }
    #[test]
    fn hop_cap_produces_explicit_insufficiency_and_offline_search_uses_no_model() {
        let (mut chat, _, observed) = fixture(
            vec![RetrievalDecision::Search(vec!["unmatched".into()]); 4],
            false,
            false,
        );
        assert!(
            !chat
                .ask("unmatched", &Cancellation::default())
                .unwrap_or_else(|_| panic!("answer"))
                .supported()
        );
        assert_eq!(
            observed.lock().unwrap_or_else(|_| panic!("fixture")).len(),
            MAX_MODEL_CALLS
        );
        assert!(
            chat.search("lighthouse", &Cancellation::default())
                .unwrap_or_else(|_| panic!("search"))
                .supported()
        );
        assert_eq!(
            observed.lock().unwrap_or_else(|_| panic!("fixture")).len(),
            MAX_MODEL_CALLS
        );
    }
    #[test]
    fn deadline_refuses_new_model_work_before_dispatch() {
        use std::sync::atomic::{AtomicU64, Ordering};
        struct Expired(AtomicU64);
        impl Clock for Expired {
            fn milliseconds(&self) -> u64 {
                self.0.fetch_add(CHAT_DEADLINE_MS, Ordering::SeqCst)
            }
        }
        let (chat, _, observed) =
            fixture(vec![RetrievalDecision::Supported(vec![0])], false, false);
        let mut expired = ChatSession::new(
            chat.corpus,
            chat.transport,
            chat.lease,
            Expired(AtomicU64::new(0)),
            chat.provider,
        );
        assert_eq!(
            expired.ask("lighthouse", &Cancellation::default()),
            Err(ChatError::Model(ModelError::Timeout))
        );
        assert!(
            observed
                .lock()
                .unwrap_or_else(|_| panic!("fixture"))
                .is_empty()
        );
    }
}
