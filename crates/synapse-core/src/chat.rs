use crate::{
    AccessPolicy, Cancellation, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    NoteReadPort, Priority, PublicError, verify_evidence,
};
use std::collections::VecDeque;

pub const MAX_CHAT_TURNS: usize = 3;
pub const MAX_MODEL_CALLS: usize = 3;
pub const MAX_CONTEXT_BYTES: usize = 1024;
pub const MAX_EVIDENCE_INPUT_BYTES: usize = 1400;
pub const MAX_RETRIEVAL_CANDIDATES: usize = 24;
struct Turn {
    question: String,
    sources: Vec<Evidence>,
}
pub struct Answer {
    pub sources: Vec<Evidence>,
}
impl Answer {
    pub fn sufficient(&self) -> bool {
        !self.sources.is_empty()
    }
}
pub struct ChatSession {
    corpus: Corpus,
    history: VecDeque<Turn>,
    last: Vec<Evidence>,
}
impl ChatSession {
    pub fn new(reader: &impl NoteReadPort, policy: AccessPolicy) -> Result<Self, PublicError> {
        Ok(Self {
            corpus: Corpus::build(reader, policy)?,
            history: VecDeque::new(),
            last: Vec::new(),
        })
    }
    pub fn reset(&mut self) {
        self.history.clear();
        self.last.clear();
    }
    pub fn inspect(
        &self,
        ordinal: usize,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Evidence, PublicError> {
        let passage = self
            .last
            .get(ordinal.checked_sub(1).ok_or(PublicError::Usage)?)
            .ok_or(PublicError::Usage)?;
        if !verify_evidence(reader, policy, passage) {
            return Err(PublicError::AccessRefused);
        }
        Ok(passage.clone())
    }
    pub fn ask(
        &mut self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
        model: &dyn ModelService,
        cancel: &Cancellation,
    ) -> Result<Answer, PublicError> {
        if question.trim().is_empty() || question.len() > MAX_CONTEXT_BYTES {
            return Err(PublicError::Usage);
        }
        if cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        self.corpus.refresh(reader, policy.clone())?;
        self.history.retain(|turn| {
            turn.sources
                .iter()
                .all(|source| verify_evidence(reader, policy, source))
        });
        let mut context = String::new();
        for turn in &self.history {
            context.push_str("Earlier question: ");
            context.push_str(&turn.question);
            context.push('\n');
        }
        context.push_str("Latest question: ");
        context.push_str(question);
        if context.len() > MAX_CONTEXT_BYTES {
            return Err(PublicError::ContextOverflow);
        }
        let mut candidates = self.corpus.query(&context, reader, policy);
        let mut calls = 0;
        if candidates.is_empty() && self.corpus.note_count() > 0 {
            match model.execute(
                ModelJob::SearchTerms {
                    question: context.clone(),
                },
                Priority::Interactive,
                cancel,
            )? {
                ModelResult::SearchTerms(terms)
                    if !terms.is_empty()
                        && terms.len() <= 4
                        && terms.iter().all(|term| term.chars().count() <= 48) =>
                {
                    candidates = self.corpus.query(&terms.join(" "), reader, policy);
                    calls += 1;
                }
                _ => return Err(PublicError::InvalidModelOutput),
            }
        }
        let mut sources = Vec::new();
        let mut attempted = Vec::new();
        for _ in calls..MAX_MODEL_CALLS {
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            let evidence = bounded(
                &candidates,
                MAX_EVIDENCE_INPUT_BYTES.saturating_sub(context.len()),
            );
            if evidence.is_empty() {
                break;
            }
            let mut signature: Vec<_> = evidence
                .iter()
                .map(|source| (source.path.clone(), source.start_line, source.end_line))
                .collect();
            signature.sort();
            if attempted.contains(&signature) {
                break;
            }
            attempted.push(signature);
            let result = model.execute(
                ModelJob::SelectEvidence {
                    question: context.clone(),
                    evidence: evidence.clone(),
                },
                Priority::Interactive,
                cancel,
            )?;
            match result {
                ModelResult::Selected(ids) => {
                    if ids.is_empty() || ids.len() > 4 {
                        return Err(PublicError::InvalidModelOutput);
                    }
                    for id in ids {
                        let passage = evidence
                            .iter()
                            .find(|passage| passage.id == id)
                            .ok_or(PublicError::InvalidModelOutput)?;
                        if sources.iter().any(|prior: &Evidence| prior.id == id)
                            || !verify_evidence(reader, policy, passage)
                        {
                            return Err(PublicError::AccessRefused);
                        }
                        sources.push(passage.clone());
                    }
                    break;
                }
                ModelResult::InsufficientEvidence => {
                    let prior = candidates.clone();
                    for passage in &prior {
                        for path in self.corpus.linked(&passage.path, reader, policy) {
                            if candidates.len() >= MAX_RETRIEVAL_CANDIDATES {
                                break;
                            }
                            if candidates.iter().any(|existing| existing.path == path) {
                                continue;
                            }
                            if let Some(linked) = self.corpus.passage_for(&path, reader, policy) {
                                candidates.push(linked);
                            }
                        }
                    }
                    let shift = evidence.len().min(candidates.len());
                    candidates.rotate_left(shift);
                }
                ModelResult::Healthy | ModelResult::SearchTerms(_) => {
                    return Err(PublicError::InvalidModelOutput);
                }
            }
        }
        if cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        for (ordinal, source) in sources.iter_mut().enumerate() {
            source.id = ordinal + 1;
        }
        self.last = sources.clone();
        self.history.push_back(Turn {
            question: question.to_owned(),
            sources: sources.clone(),
        });
        while self.history.len() > MAX_CHAT_TURNS {
            self.history.pop_front();
        }
        Ok(Answer { sources })
    }
}
fn bounded(candidates: &[Evidence], mut budget: usize) -> Vec<Evidence> {
    let mut result = Vec::new();
    for candidate in candidates.iter().take(MAX_RETRIEVAL_CANDIDATES) {
        if result.len() == 4 || budget < 64 {
            break;
        }
        let mut text = String::new();
        let mut count = 0;
        for line in candidate.text.lines().take(6) {
            let extra = line.len() + usize::from(count > 0);
            if text.len() + extra + 64 > budget {
                break;
            }
            if count > 0 {
                text.push('\n');
            }
            text.push_str(line);
            count += 1;
        }
        if text.trim().is_empty() {
            continue;
        }
        budget = budget.saturating_sub(text.len() + 64);
        result.push(Evidence {
            id: result.len() + 1,
            path: candidate.path.clone(),
            start_line: candidate.start_line,
            end_line: candidate.start_line + count - 1,
            text,
        });
    }
    result
}
