use crate::coverage::has_numeric_value;
use crate::{
    AccessPolicy, Cancellation, Corpus, Evidence, ModelJob, ModelResult, ModelService,
    NoteReadPort, Priority, PublicError, verify_evidence,
};
use std::collections::VecDeque;

pub const MAX_CHAT_TURNS: usize = 3;
pub const MAX_CONTEXT_BYTES: usize = 1024;
pub const MAX_EVIDENCE_INPUT_BYTES: usize = 32 * 1024;
pub const MAX_RETRIEVAL_CANDIDATES: usize = 64;
struct Turn {
    question: String,
    sources: Vec<Evidence>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnswerOutcome {
    Answered,
    InsufficientEvidence,
}
pub struct Answer {
    pub sources: Vec<Evidence>,
    pub outcome: AnswerOutcome,
}
impl Answer {
    pub fn sufficient(&self) -> bool {
        self.outcome == AnswerOutcome::Answered
    }
}
#[derive(Clone, Copy, Default)]
pub struct QueryStats {
    pub calls: usize,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub candidate_ranges: usize,
    pub served_ranges: usize,
    pub final_ranges: usize,
}
pub struct ChatSession {
    corpus: Corpus,
    history: VecDeque<Turn>,
    last: Vec<Evidence>,
    stats: QueryStats,
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
        Self::with_index(reader, policy, None)
    }
    pub fn with_index(
        reader: &impl NoteReadPort,
        policy: AccessPolicy,
        index: Option<std::sync::Arc<dyn crate::SearchIndexPort>>,
    ) -> Result<Self, PublicError> {
        Ok(Self {
            corpus: Corpus::build_with_index(reader, policy, index)?,
            history: VecDeque::new(),
            last: Vec::new(),
            stats: QueryStats::default(),
        })
    }
    pub fn stats(&self) -> QueryStats {
        self.stats
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
            .search_checked(terms, reader, policy)?
            .into_iter()
            .filter(|source| verify_evidence(reader, policy, source))
            .collect();
        self.last = sources.clone();
        Ok(Answer {
            outcome: if sources.is_empty() {
                AnswerOutcome::InsufficientEvidence
            } else {
                AnswerOutcome::Answered
            },
            sources,
        })
    }
    pub fn ask(
        &mut self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
        model: &dyn ModelService,
        cancel: &Cancellation,
    ) -> Result<Answer, PublicError> {
        self.ask_with_profile(
            question,
            reader,
            policy,
            model,
            cancel,
            crate::OutputProfile::CLI,
        )
    }
    pub fn ask_with_profile(
        &mut self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
        model: &dyn ModelService,
        cancel: &Cancellation,
        profile: crate::OutputProfile,
    ) -> Result<Answer, PublicError> {
        if question.trim().is_empty() || question.len() > MAX_CONTEXT_BYTES {
            return Err(PublicError::Usage);
        }
        self.stats = QueryStats::default();
        let budget = model.budget();
        let started = reader.monotonic_millis();
        let check = || {
            if cancel.is_cancelled() {
                Err(PublicError::Cancelled)
            } else if reader.monotonic_millis().saturating_sub(started) >= crate::WORKFLOW_MILLIS {
                Err(PublicError::ResourceLimit)
            } else {
                Ok(())
            }
        };
        check()?;
        self.corpus.refresh(reader, policy.clone())?;
        check()?;
        self.history.retain(|turn| {
            turn.sources
                .iter()
                .all(|source| verify_evidence(reader, policy, source))
        });
        let mut context = String::new();
        for turn in &self.history {
            let line = format!("Earlier question: {}\n", turn.question);
            if context.len() + line.len() + question.len() + 18 <= MAX_CONTEXT_BYTES {
                context.push_str(&line);
            }
        }
        context.push_str("Latest question: ");
        context.push_str(question);
        let requirements = crate::question_requirements(question)?;
        let mut sources = Vec::new();
        let mut outcome = AnswerOutcome::InsufficientEvidence;
        let mut tokens = 0u64;
        if self.corpus.note_count() > 0 {
            let initial = self
                .corpus
                .query_packets_for_question(question, question, reader, policy)?;
            let mut planning_packets = Vec::new();
            for packet in initial {
                if planning_packets
                    .iter()
                    .any(|p: &crate::EvidencePacket| p.path == packet.path)
                {
                    continue;
                }
                planning_packets.push(packet);
                if planning_packets.len() == 3 {
                    break;
                }
            }
            let planning_evidence = compact_ranges(
                self.corpus
                    .resolve_packets(&planning_packets, reader, policy)?,
                reader,
                crate::OutputProfile {
                    ranges: 12,
                    excerpt_chars: 1200,
                },
            )?
            .into_iter()
            .take(6)
            .collect::<Vec<_>>();
            let mut planning_snapshots = Vec::new();
            for source in &planning_evidence {
                planning_snapshots.push((
                    source.path.clone(),
                    crate::ContentHash::of(reader.read_note(&source.path)?.as_bytes()),
                ));
            }
            self.stats.calls += 1;
            let plan = match model.execute(
                ModelJob::PlanQuestion {
                    question: context.clone(),
                    requirements: requirements.clone(),
                    // Requirements describe the question, never obligations
                    // copied from whichever passages discovery happened to rank.
                    evidence: Vec::new(),
                },
                Priority::Interactive,
                cancel,
            )? {
                ModelResult::QuestionPlan(plan) => plan,
                _ => return Err(PublicError::InvalidModelOutput),
            };
            for (path, hash) in &planning_snapshots {
                if crate::ContentHash::of(reader.read_note(path)?.as_bytes()) != *hash {
                    return Err(PublicError::AccessRefused);
                }
            }
            if !planning_evidence
                .iter()
                .all(|e| verify_evidence(reader, policy, e))
            {
                return Err(PublicError::AccessRefused);
            }
            crate::validate_plan_with_budget(&requirements, &plan, budget)?;
            crate::corpus::validate_expansion_capacity(question, &plan.hints)?;
            let (requirements, hints) =
                crate::refine_question_with_budget(&requirements, &plan, budget)?;
            crate::corpus::validate_expansion_capacity(question, &hints)?;
            tokens += plan.prompt_tokens;
            self.stats.completion_tokens += plan.completion_tokens;
            self.stats.prompt_tokens = tokens;
            check()?;
            let mut ranked: Vec<(f64, crate::EvidencePacket)> = Vec::new();
            let mut queries = vec![(question.to_owned(), false)];
            queries.extend(
                crate::coverage::quoted_phrases(question)
                    .into_iter()
                    .map(|q| (q, true)),
            );
            for requirement in &requirements {
                queries.push((requirement.text.clone(), false));
                if let Some(hint) = hints.iter().find(|hint| hint.id == requirement.id) {
                    for term in &hint.terms {
                        queries.push((format!("{} {}", requirement.text, term), false));
                    }
                }
            }
            // Reciprocal rank fusion uses independent original/per-clause/hint
            // lists. Every clause gets candidates before global diversity.
            let mut reserved = Vec::new();
            for (query, phrase) in queries {
                let packets = if phrase {
                    self.corpus
                        .query_phrase_packets(&query, question, reader, policy)?
                } else {
                    self.corpus
                        .query_packets_for_question(&query, question, reader, policy)?
                };
                if let Some(first) = packets.first() {
                    reserved.push((first.source_hash, first.primary.bytes.clone()));
                }
                for (rank, packet) in packets.into_iter().enumerate() {
                    let score = 1.0 / (60 + rank + 1) as f64;
                    if let Some((prior, _)) = ranked.iter_mut().find(|(_, p)| {
                        p.source_hash == packet.source_hash
                            && p.primary.bytes == packet.primary.bytes
                    }) {
                        *prior += score;
                    } else {
                        ranked.push((score, packet));
                    }
                }
            }
            ranked.sort_by(|a, b| {
                let reserve = |p: &crate::EvidencePacket| {
                    reserved.contains(&(p.source_hash, p.primary.bytes.clone()))
                };
                reserve(&b.1)
                    .cmp(&reserve(&a.1))
                    .then_with(|| b.0.total_cmp(&a.0))
                    .then_with(|| a.1.path.cmp(&b.1.path))
                    .then_with(|| a.1.primary.bytes.start.cmp(&b.1.primary.bytes.start))
            });
            let mut packets: Vec<_> = ranked
                .into_iter()
                .take(crate::MAX_CANDIDATE_PACKETS - 19)
                .map(|(_, p)| p)
                .collect();
            for packet in planning_packets {
                if !packets.iter().any(|p| {
                    p.source_hash == packet.source_hash && p.primary.bytes == packet.primary.bytes
                }) {
                    packets.push(packet);
                }
            }
            let mut candidates = compact_ranges(
                self.corpus
                    .resolve_packets(&packets, reader, policy)?
                    .into_iter()
                    .filter(|e| e.text.chars().count() <= profile.excerpt_chars)
                    .collect(),
                reader,
                crate::OutputProfile {
                    ranges: crate::MAX_CANDIDATE_RANGES,
                    excerpt_chars: profile.excerpt_chars,
                },
            )?;
            self.stats.candidate_ranges = candidates.len();
            // Bind whole source bytes, not only the excerpt, across all stages.
            let mut snapshots = Vec::new();
            for source in &candidates {
                if !snapshots.iter().any(|(path, _)| path == &source.path) {
                    snapshots.push((
                        source.path.clone(),
                        crate::ContentHash::of(reader.read_note(&source.path)?.as_bytes()),
                    ));
                }
            }
            let snapshots = std::cell::RefCell::new(snapshots);
            let fresh = |items: &[Evidence]| -> Result<(), PublicError> {
                check()?;
                for item in items {
                    let snapshot = snapshots.borrow();
                    let (_, expected) = snapshot
                        .iter()
                        .find(|(path, _)| path == &item.path)
                        .ok_or(PublicError::AccessRefused)?;
                    let current = reader.read_note(&item.path)?;
                    if !verify_evidence(reader, policy, item)
                        || *expected != crate::ContentHash::of(current.as_bytes())
                    {
                        return Err(PublicError::AccessRefused);
                    }
                }
                Ok(())
            };
            let mut ledger: Vec<Vec<Evidence>> = vec![Vec::new(); requirements.len()];
            let mut conflicts: Vec<Vec<Evidence>> = vec![Vec::new(); requirements.len()];
            let mut served = Vec::new();
            let mut assessments = 0;
            while assessments < crate::MAX_ASSESSMENTS {
                let mut batch: Vec<Evidence> =
                    ledger.iter().chain(&conflicts).flatten().cloned().collect();
                dedup_ranges(&mut batch);
                if batch.len() > crate::MAX_LEDGER_RANGES {
                    return Err(PublicError::ResourceLimit);
                }
                let missing: Vec<_> = requirements
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| ledger[*i].is_empty())
                    .map(|(_, r)| r.text.as_str())
                    .collect();
                let mut pending: Vec<_> = candidates
                    .iter()
                    .filter(|candidate| !served.contains(&candidate.id))
                    .collect();
                if !served.is_empty() {
                    pending.sort_by_key(|candidate| {
                        std::cmp::Reverse(crate::corpus::requirement_relevance(
                            &candidate.text,
                            &missing,
                        ))
                    });
                }
                for candidate in pending {
                    if batch.len() == crate::MAX_LEDGER_RANGES {
                        break;
                    }
                    if !served.contains(&candidate.id)
                        && !batch.iter().any(|e| same_range(e, candidate))
                    {
                        batch.push(candidate.clone());
                    }
                }
                if batch.is_empty() || batch.iter().all(|e| served.contains(&e.id)) {
                    break;
                }
                fresh(&batch)?;
                if tokens >= budget.workflow_prompt_tokens() {
                    return Err(PublicError::ResourceLimit);
                }
                self.stats.calls += 1;
                assessments += 1;
                let assessment = match model.execute(
                    ModelJob::AssessEvidence {
                        purpose: crate::AssessmentPurpose::Collect,
                        question: context.clone(),
                        requirements: requirements.clone(),
                        evidence: batch.clone(),
                    },
                    Priority::Interactive,
                    cancel,
                )? {
                    ModelResult::Assessment(value) => value,
                    _ => return Err(PublicError::InvalidModelOutput),
                };
                crate::validate_assessment_with_budget(&requirements, &batch, &assessment, budget)?;
                tokens += assessment.prompt_tokens;
                self.stats.completion_tokens += assessment.completion_tokens;
                self.stats.prompt_tokens = tokens;
                self.stats.served_ranges += assessment.served_ids.len();
                if tokens > budget.workflow_prompt_tokens() {
                    return Err(PublicError::ResourceLimit);
                }
                fresh(&batch)?;
                for id in &assessment.served_ids {
                    if !served.contains(id) {
                        served.push(*id);
                    }
                }
                for row in assessment.support {
                    let index = requirements
                        .iter()
                        .position(|r| r.id == row.id)
                        .ok_or(PublicError::InvalidModelOutput)?;
                    if row.state.complete() {
                        // A later judgment may resolve a conflict only after
                        // seeing every retained opposing range in this call.
                        // Global served IDs cannot establish current context.
                        if conflicts[index]
                            .iter()
                            .any(|e| !assessment.served_ids.contains(&e.id))
                        {
                            ledger[index].clear();
                            continue;
                        }
                        let support_text = row
                            .supporting_ids()
                            .filter_map(|id| batch.iter().find(|e| e.id == id))
                            .map(|e| e.text.as_str())
                            .collect::<Vec<_>>()
                            .join(" ");
                        if requirements[index].kind == crate::RequirementKind::Value
                            && !has_numeric_value(&support_text)
                        {
                            ledger[index].clear();
                            continue;
                        }
                        ledger[index] = row
                            .supporting_ids()
                            .filter_map(|id| batch.iter().find(|e| e.id == id).cloned())
                            .collect();
                        conflicts[index].clear();
                    } else if row.state == crate::SupportState::Conflicting {
                        ledger[index].clear();
                        conflicts[index].extend(
                            row.supporting_ids()
                                .filter_map(|id| batch.iter().find(|e| e.id == id).cloned()),
                        );
                        dedup_ranges(&mut conflicts[index]);
                    }
                }
                if ledger.iter().any(|entry| entry.is_empty())
                    && packets.len() < crate::MAX_CANDIDATE_PACKETS
                {
                    let focus = requirements
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| ledger[*i].is_empty())
                        .map(|(_, r)| r.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");
                    for represented in batch
                        .iter()
                        .filter(|e| assessment.served_ids.contains(&e.id))
                        .take(4)
                    {
                        let follow =
                            self.corpus
                                .followup_packets(represented, &focus, reader, policy)?;
                        let related =
                            self.corpus
                                .related_packets(represented, &focus, reader, policy)?;
                        for packet in follow.into_iter().chain(related) {
                            if packets.len() == crate::MAX_CANDIDATE_PACKETS {
                                break;
                            }
                            if packets.iter().any(|p| {
                                p.source_hash == packet.source_hash
                                    && p.primary.bytes == packet.primary.bytes
                            }) {
                                continue;
                            }
                            let ranges = self.corpus.resolve_packets(
                                std::slice::from_ref(&packet),
                                reader,
                                policy,
                            )?;
                            for mut range in ranges {
                                if range.text.chars().count() > profile.excerpt_chars
                                    || candidates.iter().any(|e| same_range(e, &range))
                                {
                                    continue;
                                }
                                if !snapshots
                                    .borrow()
                                    .iter()
                                    .any(|(path, _)| path == &range.path)
                                {
                                    snapshots.borrow_mut().push((
                                        range.path.clone(),
                                        crate::ContentHash::of(
                                            reader.read_note(&range.path)?.as_bytes(),
                                        ),
                                    ));
                                }
                                if candidates.len() == crate::MAX_CANDIDATE_RANGES {
                                    break;
                                }
                                range.id = candidates.len() + 1;
                                candidates.push(range);
                            }
                            packets.push(packet);
                        }
                    }
                }
                self.stats.candidate_ranges = candidates.len();
                let mut union: Vec<_> =
                    ledger.iter().chain(&conflicts).flatten().cloned().collect();
                dedup_ranges(&mut union);
                if union.len() > crate::MAX_LEDGER_RANGES {
                    return Err(PublicError::ResourceLimit);
                }
                if ledger
                    .iter()
                    .zip(&conflicts)
                    .all(|(support, opposing)| !support.is_empty() && opposing.is_empty())
                {
                    let mut protected_context = union.clone();
                    // Selection can conflate two requested attributes even
                    // when both were supplied (for example one metric for
                    // both halves of a comparison). Preserve represented
                    // question anchors for the small-set reassessment. These
                    // companions are not accepted support until compaction
                    // and final confirmation validate the actual union.
                    let assessed: Vec<_> = batch
                        .iter()
                        .filter(|e| {
                            requirements.len() > 1
                                && assessment.served_ids.contains(&e.id)
                                && !factual_prose_lines(&e.text, question).is_empty()
                        })
                        .cloned()
                        .collect();
                    let mut retained: Vec<_> = union.iter().map(|e| e.id).collect();
                    retain_requested_anchors(question, &assessed, &mut retained);
                    for source in assessed {
                        // A companion representing a whole explicit clause
                        // must survive to the final audit even if selection
                        // overlooked it. One shared word is insufficient.
                        if requirements.iter().any(|r| {
                            let terms = requested_anchor_terms(&r.text);
                            !terms.is_empty()
                                && terms.iter().all(|term| {
                                    crate::corpus::any_request_term_in(term, &source.text)
                                })
                        }) && !protected_context.iter().any(|e| same_range(e, &source))
                        {
                            protected_context.push(source.clone());
                        }
                        if retained.contains(&source.id)
                            && !union.iter().any(|e| same_range(e, &source))
                        {
                            union.push(source);
                        }
                    }
                    if union.len() > crate::MAX_LEDGER_RANGES {
                        return Err(PublicError::ResourceLimit);
                    }
                    let mut final_sources = compact_ranges(union, reader, profile)?;
                    // Compaction renumbers and may merge contiguous ranges.
                    // Bind protection to the original retained text, retaining
                    // its new container ID without promoting discovery text
                    // in that container into protected support.
                    let protected_support: Vec<_> = protected_context
                        .into_iter()
                        .filter_map(|source| {
                            final_sources
                                .iter()
                                .find(|range| {
                                    range.path == source.path
                                        && range.start_line <= source.start_line
                                        && range.end_line >= source.end_line
                                })
                                .map(|range| Evidence {
                                    id: range.id,
                                    ..source
                                })
                        })
                        .collect();
                    if final_sources.len() > 1 {
                        if assessments == crate::MAX_ASSESSMENTS {
                            break;
                        }
                        fresh(&final_sources)?;
                        self.stats.calls += 1;
                        assessments += 1;
                        let compact = match model.execute(
                            ModelJob::AssessEvidence {
                                purpose: crate::AssessmentPurpose::Compact,
                                question: context.clone(),
                                requirements: requirements.clone(),
                                evidence: final_sources.clone(),
                            },
                            Priority::Interactive,
                            cancel,
                        )? {
                            ModelResult::Assessment(value) => value,
                            _ => return Err(PublicError::InvalidModelOutput),
                        };
                        crate::validate_assessment_with_budget(
                            &requirements,
                            &final_sources,
                            &compact,
                            budget,
                        )?;
                        tokens += compact.prompt_tokens;
                        self.stats.prompt_tokens = tokens;
                        self.stats.completion_tokens += compact.completion_tokens;
                        self.stats.served_ranges += compact.served_ids.len();
                        if tokens > budget.workflow_prompt_tokens() {
                            return Err(PublicError::ResourceLimit);
                        }
                        fresh(&final_sources)?;
                        if compact.served_ids.len() != final_sources.len() {
                            return Err(PublicError::InvalidModelOutput);
                        }
                        let mut incomplete = Vec::new();
                        for row in &compact.support {
                            let index = requirements
                                .iter()
                                .position(|r| r.id == row.id)
                                .ok_or(PublicError::InvalidModelOutput)?;
                            if row.state == crate::SupportState::Conflicting {
                                for id in row.supporting_ids() {
                                    let span = final_sources
                                        .iter()
                                        .find(|e| e.id == id)
                                        .ok_or(PublicError::InvalidModelOutput)?;
                                    // Compaction IDs are temporary. Retain the
                                    // original batch ranges and their stable
                                    // workflow IDs, including all contributors
                                    // to a merged contiguous output range.
                                    let originals: Vec<_> = batch
                                        .iter()
                                        .filter(|e| {
                                            e.path == span.path
                                                && e.start_line <= span.end_line
                                                && e.end_line >= span.start_line
                                        })
                                        .cloned()
                                        .collect();
                                    if originals.is_empty() {
                                        return Err(PublicError::InvalidModelOutput);
                                    }
                                    conflicts[index].extend(originals);
                                }
                                dedup_ranges(&mut conflicts[index]);
                            }
                            let numerical = requirements[index].kind
                                != crate::RequirementKind::Value
                                || row.supporting_ids().any(|id| {
                                    final_sources
                                        .iter()
                                        .find(|e| e.id == id)
                                        .is_some_and(|e| has_numeric_value(&e.text))
                                });
                            if !row.state.complete() || !numerical {
                                incomplete.push(index);
                            }
                        }
                        if !incomplete.is_empty() {
                            for index in incomplete {
                                ledger[index].clear();
                            }
                            continue;
                        }
                        let mut selected = compact
                            .support
                            .iter()
                            .flat_map(|row| row.supporting_ids())
                            .collect::<Vec<_>>();
                        retain_requested_anchors(question, &protected_support, &mut selected);
                        final_sources.retain(|e| selected.contains(&e.id));
                        final_sources = compact_ranges(final_sources, reader, profile)?;
                    }
                    if final_sources.is_empty()
                        || requirements
                            .iter()
                            .any(|r| r.kind == crate::RequirementKind::Value)
                            && !question_numbers_supported(question, &final_sources)
                        || !coverage_constraints(question, &final_sources, reader)?
                    {
                        continue;
                    }
                    fresh(&final_sources)?;
                    self.stats.calls += 1;
                    let confirmation = match model.execute(
                        ModelJob::ConfirmCoverage {
                            question: context.clone(),
                            requirements: requirements.clone(),
                            evidence: final_sources.clone(),
                        },
                        Priority::Interactive,
                        cancel,
                    )? {
                        ModelResult::Assessment(value) => value,
                        _ => return Err(PublicError::InvalidModelOutput),
                    };
                    crate::validate_assessment_with_budget(
                        &requirements,
                        &final_sources,
                        &confirmation,
                        budget,
                    )?;
                    tokens += confirmation.prompt_tokens;
                    self.stats.completion_tokens += confirmation.completion_tokens;
                    self.stats.prompt_tokens = tokens;
                    if tokens > budget.workflow_prompt_tokens() {
                        return Err(PublicError::ResourceLimit);
                    }
                    fresh(&final_sources)?;
                    // Confirmation sees the exact complete output. No selection
                    // or excerpt shortening is permitted after this operation.
                    if confirmation.served_ids.len() == final_sources.len()
                        && confirmation.support.iter().all(|row| row.state.complete())
                        && final_sources.iter().all(|e| {
                            confirmation
                                .support
                                .iter()
                                .any(|row| row.supporting_ids().any(|id| id == e.id))
                        })
                    {
                        sources = final_sources;
                        outcome = AnswerOutcome::Answered;
                    }
                    break;
                }
            }
        }
        check()?;
        for (ordinal, source) in sources.iter_mut().enumerate() {
            source.id = ordinal + 1;
        }
        self.stats.final_ranges = sources.len();
        self.last = sources.clone();
        self.history.push_back(Turn {
            question: question.to_owned(),
            sources: sources.clone(),
        });
        while self.history.len() > MAX_CHAT_TURNS {
            self.history.pop_front();
        }
        Ok(Answer { outcome, sources })
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
        .flat_map(|e| factual_lines(&e.text, &question))
        .collect::<Vec<_>>()
        .join("\n");
    let lower = text.to_lowercase();
    let value_request = question.starts_with("what ") || question.starts_with("how ");
    for clause in measurement_clauses(&lower) {
        let data_absent = clause.contains("no ")
            && ["observation", "records", "measurement", "survey"]
                .iter()
                .any(|word| clause.contains(word));
        let explicit_absence = [
            "questions remain unsupported",
            "no supporting evidence",
            "no supporting note",
            "missing facts",
            "does not supply those missing facts",
        ]
        .iter()
        .any(|phrase| clause.contains(phrase));
        if (data_absent || explicit_absence) && question.contains("say about ") {
            let topic = question
                .split_once("about ")
                .map(|(_, topic)| topic)
                .unwrap_or(&question);
            if crate::corpus::any_request_term_in(topic, clause) {
                return Ok(false);
            }
        }
        if value_request
            && [
                "not measured",
                "never measured",
                "was not recorded",
                "no recorded",
                "not yet recorded",
                "unmeasured",
            ]
            .iter()
            .any(|phrase| clause.contains(phrase))
            && crate::corpus::all_request_terms_in(&question, clause)
        {
            return Ok(false);
        }
    }
    if (question.starts_with("did ") || question.contains("observed improvement"))
        && ["plans to", "planned to", "no trial has run", "will test"]
            .iter()
            .any(|phrase| lower.contains(phrase))
    {
        return Ok(false);
    }
    let numeric = [
        "numeric",
        "worked example",
        "how many",
        "how much",
        "percentage",
    ]
    .iter()
    .any(|word| question.contains(word));
    let measured_accuracy = question.contains("accuracy")
        && ["measured", "test", "recorded", "reported", "achiev"]
            .iter()
            .any(|term| question.contains(term));
    if (numeric || measured_accuracy) && !has_numeric_value(&text) {
        return Ok(false);
    }
    if measured_accuracy && !measured_subject_supported(&question, sources) {
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
                if !subject.split_whitespace().take(1).any(|term| {
                    let term = term.trim_matches(|c: char| !c.is_alphanumeric());
                    lower
                        .split(|c: char| !c.is_alphanumeric())
                        .any(|word| word == term)
                }) {
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
    if actionable_question(&question) {
        for source in sources {
            let bytes = reader.read_note(&source.path)?;
            if !action_sections_covered(&bytes, source, sources) {
                return Ok(false);
            }
        }
    }
    if question.contains("checklist")
        || question.contains("complete list")
        || question.starts_with("list ")
        || (question.contains("pack") && question.contains("hike"))
    {
        for source in sources {
            let bytes = reader.read_note(&source.path)?;
            if !complete_selected_lists(&bytes, source, sources) {
                return Ok(false);
            }
        }
    }
    Ok(!text.trim().is_empty())
}
fn actionable_question(question: &str) -> bool {
    let question = question.to_lowercase();
    [
        "what can i try",
        "what should i try",
        "how can i fix",
        "how do i fix",
        "how should i address",
        "what can i do",
    ]
    .iter()
    .any(|phrase| question.contains(phrase))
}

fn action_sections_covered(bytes: &str, source: &Evidence, sources: &[Evidence]) -> bool {
    let lines: Vec<_> = bytes.lines().collect();
    let mut ancestors: Vec<(usize, usize)> = Vec::new();
    let mut section_ends = vec![lines.len(); lines.len()];
    for (index, line) in lines.iter().enumerate() {
        let level = line.bytes().take_while(|byte| *byte == b'#').count();
        if level == 0 {
            continue;
        }
        while ancestors.last().is_some_and(|(prior, _)| *prior >= level) {
            if let Some((_, start)) = ancestors.pop() {
                section_ends[start] = index;
            }
        }
        ancestors.push((level, index));
    }
    ancestors.clear();
    let mut action_section = false;
    for (index, line) in lines.iter().enumerate() {
        if line.starts_with('#') {
            let level = line.bytes().take_while(|byte| *byte == b'#').count();
            while ancestors.last().is_some_and(|(prior, _)| *prior >= level) {
                ancestors.pop();
            }
            // An action block belongs to its enclosing topic, ending at that
            // topic's next peer. Another topic's Options cannot invalidate an
            // otherwise complete selected remedy block in the same file.
            let scope_start = ancestors.last().map(|(_, start)| *start).unwrap_or(0);
            let scope_end = ancestors
                .last()
                .map(|(_, start)| section_ends[*start])
                .unwrap_or(lines.len());
            let in_selected_topic = source.start_line <= scope_end && source.end_line > scope_start;
            ancestors.push((level, index));
            let heading = line.trim_start_matches('#').trim().to_lowercase();
            action_section = in_selected_topic
                && [
                    "techniques",
                    "methods",
                    "remedies",
                    "steps",
                    "options",
                    "strategies",
                    "recommendations",
                    "mitigations",
                ]
                .iter()
                .any(|name| {
                    heading
                        .split(|c: char| !c.is_alphanumeric())
                        .any(|word| word == *name)
                });
        }
        if action_section
            && list_item(line)
            && !sources
                .iter()
                .any(|e| e.path == source.path && e.start_line <= index + 1 && e.end_line > index)
        {
            return false;
        }
    }
    true
}

fn complete_selected_lists(bytes: &str, source: &Evidence, sources: &[Evidence]) -> bool {
    // Require complete contiguous lists touched by a selected passage;
    // unrelated sections and metadata lists are not requested evidence.
    let lines: Vec<_> = bytes.lines().collect();
    let mut index = 0;
    while index < lines.len() {
        if !list_item(lines[index]) {
            index += 1;
            continue;
        }
        let start = index;
        while index < lines.len() && (list_item(lines[index]) || lines[index].trim().is_empty()) {
            index += 1;
        }
        let items: Vec<_> = (start..index).filter(|i| list_item(lines[*i])).collect();
        let covered = |line: usize| {
            sources
                .iter()
                .any(|e| e.path == source.path && e.start_line <= line + 1 && e.end_line > line)
        };
        if items.iter().any(|i| covered(*i)) && !items.iter().all(|i| covered(*i)) {
            return false;
        }
    }
    true
}

// Link labels can be factual sentence subjects, but navigation and standalone
// links cannot establish facts. Destinations never contribute factual text.
pub(crate) fn factual_lines(text: &str, question: &str) -> Vec<String> {
    factual_lines_projection(text, question, true)
}

// Linked labels remain discoverable, but do not receive substantive body-term
// weighting merely because a navigation overview names many subjects.
pub(crate) fn factual_prose_lines(text: &str, question: &str) -> Vec<String> {
    factual_lines_projection(text, question, false)
}

fn markdown_cells(line: &str) -> Option<Vec<&str>> {
    let line = line.trim();
    if !line.contains('|') {
        return None;
    }
    let line = line.strip_prefix('|').unwrap_or(line);
    let line = line.strip_suffix('|').unwrap_or(line);
    Some(line.split('|').map(str::trim).collect())
}

fn table_header_pair(header: &str, separator: &str) -> bool {
    let (Some(header), Some(separator)) = (markdown_cells(header), markdown_cells(separator))
    else {
        return false;
    };
    header.len() == separator.len()
        && separator.iter().all(|cell| {
            let cell = cell.strip_prefix(':').unwrap_or(cell);
            let cell = cell.strip_suffix(':').unwrap_or(cell);
            cell.len() >= 3 && cell.bytes().all(|byte| byte == b'-')
        })
}

fn factual_lines_projection(text: &str, question: &str, include_labels: bool) -> Vec<String> {
    let lines: Vec<_> = text.lines().collect();
    let mut structure = vec![false; lines.len()];
    for (index, pair) in lines.windows(2).enumerate() {
        if table_header_pair(pair[0], pair[1]) {
            structure[index] = true;
            structure[index + 1] = true;
        }
    }
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            if structure[index] {
                None
            } else {
                factual_line_projection(line, question, include_labels)
            }
        })
        .collect()
}

fn factual_line_projection(line: &str, question: &str, include_labels: bool) -> Option<String> {
    let line = line.trim();
    // A navigation sentence appended to factual prose must not lend its linked
    // subjects to the earlier assertion.
    let line = line
        .char_indices()
        .find_map(|(index, ch)| {
            if matches!(ch, '.' | ';') {
                let tail = line[index + ch.len_utf8()..].trim_start().to_lowercase();
                if [
                    "see ",
                    "related:",
                    "relevant sources:",
                    "sources:",
                    "links:",
                ]
                .iter()
                .any(|prefix| tail.starts_with(prefix))
                {
                    return Some(&line[..index]);
                }
            }
            None
        })
        .unwrap_or(line);
    let lower = line.to_lowercase();
    let question = question.to_lowercase();
    let question = question
        .rsplit("latest question: ")
        .next()
        .unwrap_or(&question);
    if line.is_empty()
        || line.starts_with('#')
        || line.contains('?')
        || lower.split('|').any(|cell| {
            cell.trim().trim_end_matches(['.', '?']) == question.trim().trim_end_matches(['.', '?'])
        })
        || [
            "see ",
            "related:",
            "compare ",
            "search terms:",
            "relevant sources:",
            "sources:",
            "links:",
        ]
        .iter()
        .any(|p| lower.starts_with(p))
    {
        return None;
    }
    let mut plain = String::new();
    let mut prose = String::new();
    let mut linked = false;
    let mut rest = line;
    while let Some(start) = rest.find('[') {
        plain.push_str(&rest[..start]);
        prose.push_str(&rest[..start]);
        let link = &rest[start..];
        let parsed = if link.starts_with("[[") {
            link.find("]]").map(|i| {
                let label = link[2..i].rsplit('|').next().unwrap_or("");
                (i + 2, label)
            })
        } else {
            link.find("](")
                .and_then(|i| link[i + 2..].find(')').map(|j| (i + j + 3, &link[1..i])))
        };
        let Some((end, label)) = parsed else {
            plain.push_str(link);
            prose.push_str(link);
            rest = "";
            break;
        };
        linked = true;
        if include_labels {
            plain.push_str(label);
        }
        rest = &link[end..];
    }
    plain.push_str(rest);
    prose.push_str(rest);
    if linked
        && [
            "start with ",
            "then compare ",
            "read ",
            "review ",
            "report ",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return None;
    }
    if linked
        && prose.split(|c: char| !c.is_alphanumeric()).any(|word| {
            ["bookmark", "bookmarked", "bookmarks"].contains(&word.to_lowercase().as_str())
        })
    {
        return None;
    }
    if linked
        && !prose.split(|c: char| !c.is_alphanumeric()).any(|word| {
            !word.is_empty() && !["and", "or", "the"].contains(&word.to_lowercase().as_str())
        })
    {
        return None;
    }
    plain.chars().any(char::is_alphanumeric).then_some(plain)
}

fn measured_subject_supported(question: &str, sources: &[Evidence]) -> bool {
    const GENERIC: &[&str] = &[
        "what",
        "was",
        "the",
        "measured",
        "test",
        "accuracy",
        "experiment",
        "model",
        "study",
        "project",
        "result",
        "results",
        "did",
        "achieve",
        "achieved",
        "its",
        "for",
        "and",
        "with",
        "has",
        "have",
        "been",
        "recorded",
        "reported",
        "measurement",
        "percentage",
        "how",
        "much",
    ];
    let subjects: Vec<_> = question
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.len() >= 3 && !GENERIC.contains(word))
        .collect();
    sources.iter().any(|source| {
        factual_lines(&source.text, question)
            .into_iter()
            .any(|line| {
                measurement_clauses(&line).into_iter().any(|clause| {
                    let lower = clause.to_lowercase();
                    let words: Vec<_> = lower.split(|c: char| !c.is_alphanumeric()).collect();
                    if !accuracy_value_attributed(&lower)
                        || words.iter().any(|word| {
                            [
                                "no",
                                "not",
                                "never",
                                "without",
                                "unmeasured",
                                "unknown",
                                "unavailable",
                                "plan",
                                "plans",
                                "planned",
                                "planning",
                                "target",
                                "targets",
                                "targeted",
                            ]
                            .contains(word)
                        })
                    {
                        return false;
                    }
                    // Both the requested subject and measurement must belong to
                    // this clause. Nearby prose about another experiment cannot
                    // lend its subject to an unrelated numerical result.
                    subjects.iter().all(|subject| words.contains(subject))
                })
            })
    })
}

// Keep decimal points inside values while separating independent sentences and
// semicolon clauses. This deliberately avoids inferring cross-clause reference.
fn measurement_clauses(line: &str) -> Vec<&str> {
    let mut clauses = Vec::new();
    let mut start = 0;
    for (index, ch) in line.char_indices() {
        let decimal = ch == '.'
            && index > 0
            && line.as_bytes()[index - 1].is_ascii_digit()
            && line
                .as_bytes()
                .get(index + 1)
                .is_some_and(u8::is_ascii_digit);
        if ch == ';' || (ch == '.' && !decimal) {
            clauses.push(&line[start..index]);
            start = index + ch.len_utf8();
        }
    }
    clauses.push(&line[start..]);
    clauses
}

// Require a proportion attached to the accuracy field, rather than accepting
// any digit on a line (dates and sample counts are not measurement values).
fn accuracy_value_attributed(line: &str) -> bool {
    line.match_indices("accuracy")
        .any(|(index, field)| accuracy_field_value(&line[index + field.len()..]))
}

fn accuracy_field_value(value: &str) -> bool {
    let mut words = value.split_whitespace().peekable();
    const MAX_ACCURACY_VALUE_TOKENS: usize = 4;
    for _ in 0..MAX_ACCURACY_VALUE_TOKENS {
        let Some(word) = words.next() else {
            return false;
        };
        let token = word.trim_matches(|c: char| matches!(c, ':' | '=' | '*' | ',' | ';' | '|'));
        if token.is_empty()
            || ["of", "is", "was", "at", "reached", "measured", "reported"].contains(&token)
        {
            continue;
        }
        let number = token.trim_end_matches(['%', '.', ',']);
        let Ok(number) = number.parse::<f64>() else {
            return false;
        };
        let unit: Vec<_> = words
            .take(2)
            .map(|word| word.trim_end_matches(['.', ',', ';', '|']))
            .collect();
        let percent = token.contains('%')
            || unit.first() == Some(&"percent")
            || unit.as_slice() == ["per", "cent"];
        return number.is_finite() && number >= 0.0 && number <= if percent { 100.0 } else { 1.0 };
    }
    false
}

fn list_item(line: &str) -> bool {
    let line = line.trim_start();
    if ["- ", "* ", "+ "]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return true;
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    digits > 0 && (line[digits..].starts_with(". ") || line[digits..].starts_with(") "))
}

fn numbers(text: &str) -> Vec<(f64, usize)> {
    let mut result = Vec::new();
    let mut start = None;
    for (i, ch) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if ch.is_ascii_digit() || ch == '.' && start.is_some() {
            if start.is_none() {
                start = Some(i);
            }
        } else if let Some(first) = start.take() {
            if let Ok(number) = text[first..i].trim_end_matches('.').parse::<f64>() {
                if number.is_finite() {
                    result.push((number, i));
                }
            }
        }
    }
    result
}
fn question_numbers_supported(question: &str, sources: &[Evidence]) -> bool {
    let text = sources
        .iter()
        .map(|e| e.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let values = numbers(&text);
    numbers(question).iter().all(|(number, end)| {
        let rest = question[*end..].trim_start().to_lowercase();
        let percentage = rest.starts_with("percent") || rest.starts_with('%');
        values.iter().any(|(value, _)| {
            (*value - *number).abs() < 1e-9 || percentage && (*value - *number / 100.0).abs() < 1e-9
        })
    })
}

// Model compaction cannot erase a question attribute already represented in
// verified support. This only retains ranges; it never establishes factual
// support, and final confirmation still sees the actual resulting union.
fn retain_requested_anchors(question: &str, prior: &[Evidence], selected: &mut Vec<usize>) {
    for term in requested_anchor_terms(question) {
        if prior
            .iter()
            .filter(|e| selected.contains(&e.id))
            .any(|e| crate::corpus::any_request_term_in(&term, &e.text))
        {
            continue;
        }
        if let Some(source) = prior
            .iter()
            .find(|e| crate::corpus::any_request_term_in(&term, &e.text))
        {
            selected.push(source.id);
        }
    }
}

fn requested_anchor_terms(question: &str) -> Vec<String> {
    crate::corpus::request_terms(question)
        .into_iter()
        // Question glue describes the request, not a source attribute.
        .filter(|term| {
            ![
                "giv", "gav", "get", "show", "tell", "provid", "compar", "includ", "apply",
            ]
            .contains(&term.as_str())
        })
        .collect()
}

fn same_range(a: &Evidence, b: &Evidence) -> bool {
    a.path == b.path && a.start_line == b.start_line && a.end_line == b.end_line
}
fn dedup_ranges(items: &mut Vec<Evidence>) {
    let mut seen = Vec::new();
    items.retain(|item| {
        let key = (item.path.clone(), item.start_line, item.end_line);
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
}
fn compact_ranges(
    mut items: Vec<Evidence>,
    reader: &impl NoteReadPort,
    profile: crate::OutputProfile,
) -> Result<Vec<Evidence>, PublicError> {
    let priorities: Vec<_> = items
        .iter()
        .enumerate()
        .map(|(i, e)| (e.path.clone(), e.start_line, e.end_line, i))
        .collect();
    items.sort_by(|a, b| {
        a.path
            .cmp(&b.path)
            .then_with(|| a.start_line.cmp(&b.start_line))
    });
    let mut result: Vec<Evidence> = Vec::new();
    for item in items {
        if item.text.chars().count() > profile.excerpt_chars {
            return Ok(Vec::new());
        }
        if let Some(last) = result.last_mut() {
            if last.path == item.path
                && (item.start_line <= last.end_line + 1
                    || reader
                        .read_note(&item.path)?
                        .lines()
                        .skip(last.end_line)
                        .take(item.start_line.saturating_sub(last.end_line + 1))
                        .all(|line| line.trim().is_empty()))
            {
                let end = last.end_line.max(item.end_line);
                let text = reader
                    .read_note(&item.path)?
                    .lines()
                    .skip(last.start_line - 1)
                    .take(end - last.start_line + 1)
                    .collect::<Vec<_>>()
                    .join("\n");
                if end - last.start_line < 24 && text.chars().count() <= profile.excerpt_chars {
                    last.end_line = end;
                    last.text = text;
                    continue;
                }
            }
        }
        result.push(item);
    }
    if result.len() > profile.ranges {
        return Ok(Vec::new());
    }
    result.sort_by_key(|e| {
        priorities
            .iter()
            .filter(|(path, start, end, _)| {
                *path == e.path && *start <= e.end_line && *end >= e.start_line
            })
            .map(|(_, _, _, i)| *i)
            .min()
            .unwrap_or(usize::MAX)
    });
    for (i, e) in result.iter_mut().enumerate() {
        e.id = i + 1;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_request_needs_remedies_beyond_selected_diagnosis() {
        let bytes = "# Device\nA warning indicates overheating.\n\n## Mitigations\n- Reduce load.\n- Improve ventilation.";
        let diagnosis = Evidence {
            id: 1,
            path: crate::NotePath::parse("device.md").unwrap_or_else(|e| panic!("fixture {e:?}")),
            start_line: 2,
            end_line: 2,
            text: "A warning indicates overheating.".into(),
        };
        assert!(actionable_question(
            "What can I try when the device overheats?"
        ));
        assert!(!action_sections_covered(
            bytes,
            &diagnosis,
            std::slice::from_ref(&diagnosis)
        ));
        let remedy = Evidence {
            id: 2,
            start_line: 5,
            end_line: 6,
            text: "- Reduce load.\n- Improve ventilation.".into(),
            ..diagnosis.clone()
        };
        assert!(action_sections_covered(
            bytes,
            &diagnosis,
            &[diagnosis.clone(), remedy]
        ));
    }
    #[test]
    fn partial_authentic_checklist_coordinates_are_refused() {
        let bytes = "# Checklist\n- Map\n- Water\n- Headlamp";
        let partial = Evidence {
            id: 1,
            path: crate::NotePath::parse("gear.md").unwrap_or_else(|e| panic!("fixture {e:?}")),
            start_line: 2,
            end_line: 3,
            text: "- Map\n- Water".into(),
        };
        assert!(!complete_selected_lists(
            bytes,
            &partial,
            std::slice::from_ref(&partial)
        ));
        let full = Evidence {
            end_line: 4,
            text: "- Map\n- Water\n- Headlamp".into(),
            ..partial
        };
        assert!(complete_selected_lists(
            bytes,
            &full,
            std::slice::from_ref(&full)
        ));
    }
    #[test]
    fn numerical_inputs_must_belong_to_the_proposed_output() {
        let source = |text: &str| Evidence {
            id: 1,
            path: crate::NotePath::parse("recipe.md").unwrap_or_else(|e| panic!("{e:?}")),
            start_line: 1,
            end_line: 1,
            text: text.into(),
        };
        let question = "How much water gives 70 percent hydration with 500 g flour?";
        assert!(!question_numbers_supported(
            question,
            &[source(
                "400 g flour and 260 g water give 65 percent hydration."
            )]
        ));
        assert!(question_numbers_supported(
            question,
            &[source("500 g flour times 0.70 gives 350 g water.")]
        ));
        assert!(has_numeric_value("Measured failures: zero."));
        assert!(!has_numeric_value("No battery lifetime was recorded."));
    }
    #[test]
    fn compaction_does_not_retain_an_unrelated_quantity_for_a_question_verb() {
        let range = |id, text: &str| Evidence {
            id,
            path: crate::NotePath::parse(&format!("note-{id}.md"))
                .unwrap_or_else(|e| panic!("{e:?}")),
            start_line: 1,
            end_line: 1,
            text: text.into(),
        };
        let prior = vec![
            range(
                1,
                "With 600 g flour and 480 g water, hydration is 80 percent.",
            ),
            range(
                2,
                "The other dough uses 300 g flour and 210 g water, giving 70 percent hydration.",
            ),
        ];
        let mut selected = vec![1];
        retain_requested_anchors(
            "How much water gives 80 percent hydration with 600 g flour?",
            &prior,
            &mut selected,
        );
        assert_eq!(selected, vec![1]);
    }
}
