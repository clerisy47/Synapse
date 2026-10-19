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
    /// Counts only currently permitted attention notes; no note content or
    /// identifiers cross the diagnostic boundary.
    pub fn metadata_attention(
        &self,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Option<usize> {
        if self.corpus.note_count() != 0 {
            return None;
        }
        let count = self.corpus.attention(reader, policy).len();
        (count > 0).then_some(count)
    }
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
    pub fn search(
        &mut self,
        terms: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Answer, PublicError> {
        if terms.trim().is_empty() || terms.len() > MAX_CONTEXT_BYTES {
            return Err(PublicError::Usage);
        }
        self.corpus.refresh(reader, policy.clone())?;
        let sources: Vec<_> = self
            .corpus
            .query(terms, reader, policy)
            .into_iter()
            .filter(|source| verify_evidence(reader, policy, source))
            .collect();
        self.last = sources.clone();
        Ok(Answer { sources })
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
            )?;
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
            if !evidence
                .iter()
                .all(|source| verify_evidence(reader, policy, source))
            {
                return Err(PublicError::AccessRefused);
            }
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
                    let mut selected = Vec::new();
                    for id in ids {
                        let passage = evidence
                            .iter()
                            .find(|passage| passage.id == id)
                            .ok_or(PublicError::InvalidModelOutput)?;
                        if selected.iter().any(|prior: &Evidence| prior.id == id) {
                            return Err(PublicError::InvalidModelOutput);
                        }
                        if !verify_evidence(reader, policy, passage) {
                            return Err(PublicError::AccessRefused);
                        }
                        selected.push(passage.clone());
                    }
                    if coverage_constraints(question, &selected, reader)? {
                        sources = selected;
                        break;
                    }
                    let shift = evidence.len().min(candidates.len());
                    candidates.rotate_left(shift);
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
                            for linked in self.corpus.query_note(&path, &context, reader, policy) {
                                if candidates.len() >= MAX_RETRIEVAL_CANDIDATES {
                                    break;
                                }
                                candidates.push(linked);
                            }
                        }
                    }
                    let shift = evidence.len().min(candidates.len());
                    candidates.rotate_left(shift);
                }
                ModelResult::Healthy
                | ModelResult::SearchTerms(_)
                | ModelResult::Metadata(_)
                | ModelResult::Draft(_) => {
                    return Err(PublicError::InvalidModelOutput);
                }
            }
        }
        if cancel.is_cancelled() {
            return Err(PublicError::Cancelled);
        }
        for (ordinal, source) in sources.iter_mut().enumerate() {
            if !verify_evidence(reader, policy, source) {
                return Err(PublicError::AccessRefused);
            }
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

// Necessary evidence checks supplement provider judgment. They do not claim
// semantic entailment: live fact-coverage qualification remains mandatory.
fn coverage_constraints(
    question: &str,
    sources: &[Evidence],
    reader: &impl NoteReadPort,
) -> Result<bool, PublicError> {
    let question = question.to_lowercase();
    let text = sources
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let numeric = [
        "numeric",
        "worked example",
        "how many",
        "how much",
        "percentage",
    ]
    .iter()
    .any(|word| question.contains(word));
    let measured_accuracy = question.contains("accuracy") && question.contains("measured");
    if (numeric || measured_accuracy) && !text.chars().any(|c| c.is_ascii_digit()) {
        return Ok(false);
    }
    if let Some(comparison) = question.strip_prefix("compare ") {
        let subjects = comparison.split(" for ").next().unwrap_or(comparison);
        if let Some((left, right)) = subjects
            .split_once(" and ")
            .or_else(|| subjects.split_once(" versus "))
        {
            let lower = text.to_lowercase();
            for subject in [left, right] {
                if !subject
                    .split_whitespace()
                    .take(2)
                    .any(|term| lower.contains(term.trim_end_matches(['.', '?', 's'])))
                {
                    return Ok(false);
                }
            }
        }
    }
    if question.contains("precision") && question.contains("recall") && question.contains("example")
    {
        let values = text
            .split(|c: char| !c.is_ascii_digit() && c != '.')
            .filter(|s| s.chars().any(|c| c.is_ascii_digit()))
            .count();
        if values < 2 {
            return Ok(false);
        }
    }
    if question.contains("checklist")
        || question.contains("complete list")
        || question.starts_with("list ")
        || (question.contains("pack") && question.contains("hike"))
    {
        for source in sources {
            let bytes = reader.read_note(&source.path)?;
            // All bullet items in a selected note must survive an explicitly
            // complete-list request. Refuse ambiguous partial list coverage.
            for (index, line) in bytes.lines().enumerate() {
                let item = line.trim_start();
                if (item.starts_with("- ") || item.starts_with("* ") || item.starts_with("+ "))
                    && !sources.iter().any(|e| {
                        e.path == source.path && e.start_line <= index + 1 && e.end_line > index
                    })
                {
                    return Ok(false);
                }
            }
        }
    }
    Ok(!text.trim().is_empty())
}
fn bounded(candidates: &[Evidence], mut budget: usize) -> Result<Vec<Evidence>, PublicError> {
    let mut result = Vec::new();
    for candidate in candidates.iter().take(MAX_RETRIEVAL_CANDIDATES) {
        if result.len() == 4 || budget < 64 {
            break;
        }
        // A ranked window is an indivisible source. Truncating it here can
        // remove exactly the table row or list tail retrieval selected.
        let text = &candidate.text;
        if text.trim().is_empty() || text.len() + 64 > budget {
            continue;
        }
        budget = budget.saturating_sub(text.len() + 64);
        result.push(Evidence {
            id: result.len() + 1,
            path: candidate.path.clone(),
            start_line: candidate.start_line,
            end_line: candidate.end_line,
            text: text.clone(),
        });
    }
    if result.is_empty() && !candidates.is_empty() {
        return Err(PublicError::ContextOverflow);
    }
    Ok(result)
}
