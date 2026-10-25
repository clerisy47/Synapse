//! Question coverage is distinct from relevance and citation authenticity.
use crate::{Evidence, PublicError};
use serde::{Deserialize, Serialize};
pub const MAX_REQUIREMENTS: usize = 8;
pub const MAX_LEDGER_RANGES: usize = 16;
pub const MAX_MODEL_CALLS: usize = 32;
pub const MAX_ASSESSMENTS: usize = MAX_MODEL_CALLS - 2;
pub const LOCAL_CONTEXT_TOKENS: u64 = 4096;
pub const REMOTE_CONTEXT_TOKENS: u64 = 32_768;
pub const MAX_COMPLETION_TOKENS: u64 = 512;
pub const REMOTE_COMPLETION_TOKENS: u64 = 2048;
pub const TOKEN_SAFETY_RESERVE: u64 = 64;
pub const MAX_OPERATION_PROMPT_TOKENS: u64 =
    LOCAL_CONTEXT_TOKENS - MAX_COMPLETION_TOKENS - TOKEN_SAFETY_RESERVE;
pub const MAX_SERIALIZED_REQUEST_BYTES: usize = 32 * 1024;
pub const MAX_PROMPT_TOKENS: u64 = MAX_OPERATION_PROMPT_TOKENS * (MAX_ASSESSMENTS as u64 + 2);
pub const WORKFLOW_MILLIS: u64 = 240_000;
/// Trusted transport profile; model outputs cannot select resource limits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ModelBudget {
    #[default]
    Local,
    Remote,
}
impl ModelBudget {
    pub const fn context_tokens(self) -> u64 {
        match self {
            Self::Local => LOCAL_CONTEXT_TOKENS,
            Self::Remote => REMOTE_CONTEXT_TOKENS,
        }
    }
    pub const fn completion_tokens(self) -> u64 {
        match self {
            Self::Local => MAX_COMPLETION_TOKENS,
            Self::Remote => REMOTE_COMPLETION_TOKENS,
        }
    }
    pub const fn operation_prompt_tokens(self) -> u64 {
        self.context_tokens() - self.completion_tokens() - TOKEN_SAFETY_RESERVE
    }
    pub const fn workflow_prompt_tokens(self) -> u64 {
        self.operation_prompt_tokens() * (MAX_ASSESSMENTS as u64 + 2)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirement {
    pub id: usize,
    pub text: String,
    pub kind: RequirementKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssessmentPurpose {
    Collect,
    Compact,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequirementKind {
    Fact,
    Value,
    Result,
    Topic,
    Schedule,
    Qualification,
    Existence,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportBasis {
    Recorded,
    Definition,
    Rule,
    Example,
    Absence,
    Future,
    Navigation,
}
impl RequirementKind {
    pub fn accepts(self, basis: SupportBasis) -> bool {
        use SupportBasis::*;
        match self {
            Self::Value => matches!(basis, Recorded | Example),
            Self::Result => basis == Recorded,
            Self::Schedule => matches!(basis, Recorded | Future | Rule),
            Self::Qualification | Self::Existence => basis != Navigation,
            Self::Fact | Self::Topic => matches!(basis, Recorded | Definition | Rule | Example),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequirementRefinement {
    pub clause_id: usize,
    pub text: String,
    pub kind: RequirementKind,
}
pub fn identity_refinements(clauses: &[Requirement]) -> Vec<RequirementRefinement> {
    clauses
        .iter()
        .map(|r| RequirementRefinement {
            clause_id: r.id,
            text: "Address every requested part of the original clause".into(),
            kind: r.kind,
        })
        .collect()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequirementHints {
    pub id: usize,
    pub terms: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportState {
    Supported,
    SupportedNegative,
    MissingInformation,
    Unrelated,
    Conflicting,
}
impl SupportState {
    pub fn complete(self) -> bool {
        matches!(self, Self::Supported | Self::SupportedNegative)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequirementSupport {
    pub value_evidence_id: Option<usize>,
    pub id: usize,
    pub state: SupportState,
    pub basis: SupportBasis,
    pub evidence_ids: Vec<usize>,
}
impl RequirementSupport {
    /// The numeric attribution is a support reference in its own right; an
    /// optional repeat in the context set refers to the same range once.
    pub fn supporting_ids(&self) -> impl Iterator<Item = usize> + '_ {
        self.value_evidence_id.into_iter().chain(
            self.evidence_ids
                .iter()
                .copied()
                .filter(|id| Some(*id) != self.value_evidence_id),
        )
    }
}
/// Necessary numeric compatibility, not a claim of semantic entailment.
pub fn value_evidence_compatible(requirement: &Requirement, evidence: &Evidence) -> bool {
    if requirement.kind != RequirementKind::Value || !has_numeric_value(&evidence.text) {
        return false;
    }
    let question = requirement.text.to_lowercase();
    if question.starts_with("how long")
        || question.contains("lifetime")
        || question.contains("duration")
    {
        // A nearby measurement explicitly assigned to another event cannot
        // inherit the requested subject from a heading or preceding sentence.
        // Keep this a necessary guard: ordinary contextual attribution remains
        // the assessor's responsibility, and an explicitly requested separate
        // event is still eligible.
        let lower = evidence.text.to_lowercase();
        let lower = lower
            .split('\n')
            .flat_map(|line| line.split(". "))
            .filter(|clause| {
                !["separate", "another", "different", "unrelated"]
                    .iter()
                    .any(|marker| {
                        clause.split_whitespace().any(|w| w == *marker)
                            && !question.split_whitespace().any(|w| w == *marker)
                    })
            })
            .collect::<Vec<_>>()
            .join("\n");
        let words = lower
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>();
        let units = [
            "second",
            "seconds",
            "minute",
            "minutes",
            "hour",
            "hours",
            "day",
            "days",
            "week",
            "weeks",
            "month",
            "months",
            "year",
            "years",
            "ms",
            "millisecond",
            "milliseconds",
        ];
        for (i, word) in words.iter().enumerate() {
            if !units.contains(word)
                || i > 0
                    && ["watt", "watts", "kilowatt", "ampere", "milliamp"].contains(&words[i - 1])
            {
                continue;
            }
            if i > 0 && has_numeric_value(words[i - 1])
                || i + 1 < words.len() && has_numeric_value(words[i + 1])
            {
                return true;
            }
        }
        let lines = lower.lines().collect::<Vec<_>>();
        let cells = |line: &str| {
            line.trim()
                .trim_matches('|')
                .split('|')
                .map(str::trim)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        for (i, pair) in lines.windows(2).enumerate() {
            if !pair[0].contains('|') || !pair[1].contains('|') {
                continue;
            }
            let headers = cells(pair[0]);
            let separator = cells(pair[1]);
            if headers.len() != separator.len()
                || separator
                    .iter()
                    .any(|s| s.len() < 3 || s.chars().any(|c| c != '-' && c != ':'))
            {
                continue;
            }
            for (column, header) in headers.iter().enumerate() {
                if header
                    .to_lowercase()
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|word| units.contains(&word))
                    && lines[i + 2..]
                        .iter()
                        .take_while(|line| line.contains('|'))
                        .any(|line| {
                            cells(line)
                                .get(column)
                                .is_some_and(|value| has_numeric_value(value))
                        })
                {
                    return true;
                }
            }
        }
        return false;
    }
    true
}
pub(crate) fn has_numeric_value(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_digit())
        || text.split(|c: char| !c.is_alphanumeric()).any(|word| {
            [
                "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                "ten", "eleven", "twelve",
            ]
            .contains(&word.to_lowercase().as_str())
        })
}
pub struct Assessment {
    pub support: Vec<RequirementSupport>,
    pub served_ids: Vec<usize>,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}
pub struct QuestionPlan {
    pub hints: Vec<RequirementHints>,
    pub refinements: Vec<RequirementRefinement>,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}
#[derive(Clone, Copy)]
pub struct OutputProfile {
    pub ranges: usize,
    pub excerpt_chars: usize,
}
impl OutputProfile {
    pub const CLI: Self = Self {
        ranges: 8,
        excerpt_chars: 1200,
    };
    pub const MCP: Self = Self {
        ranges: 12,
        excerpt_chars: 600,
    };
}
/// The planner may supply lexical hints, never remove explicit question clauses.
pub fn question_requirements(question: &str) -> Result<Vec<Requirement>, PublicError> {
    let parts: Vec<_> = question
        .split(['?', ';', '\n'])
        .flat_map(|part| part.split(" and "))
        .flat_map(|part| {
            let boundary = part
                .find(", including ")
                .map(|i| (i, i + 2))
                .or_else(|| part.find(" including ").map(|i| (i, i + 1)));
            match boundary {
                Some((end, start)) => vec![&part[..end], &part[start..]],
                None => vec![part],
            }
        })
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect();
    if parts.is_empty() || parts.len() > MAX_REQUIREMENTS {
        return Err(PublicError::ResourceLimit);
    }
    Ok(parts
        .into_iter()
        .enumerate()
        .map(|(i, text)| Requirement {
            id: i + 1,
            text: text.into(),
            kind: {
                let lower = text.to_lowercase();
                if lower.starts_with("including ") {
                    RequirementKind::Qualification
                } else if lower.starts_with("when ") {
                    RequirementKind::Schedule
                } else if lower.contains("say about ") {
                    RequirementKind::Topic
                } else if ["how many", "how much", "how long"]
                    .iter()
                    .any(|p| lower.starts_with(p))
                    || lower.starts_with("what ") && lower.contains("measured")
                    || ["what was ", "what were ", "what is the ", "what are the "]
                        .iter()
                        .any(|prefix| lower.starts_with(prefix))
                        && ["duration", "lifetime"].iter().any(|attribute| {
                            lower.split_whitespace().any(|word| {
                                word.trim_matches(|c: char| !c.is_alphanumeric()) == *attribute
                            })
                        })
                {
                    RequirementKind::Value
                } else if lower.starts_with("did ")
                    && ["improve", "increase", "decrease", "reduce"]
                        .iter()
                        .any(|p| lower.contains(p))
                {
                    RequirementKind::Result
                } else {
                    RequirementKind::Fact
                }
            },
        })
        .collect())
}
pub fn validate_plan(requirements: &[Requirement], plan: &QuestionPlan) -> Result<(), PublicError> {
    validate_plan_with_budget(requirements, plan, ModelBudget::Local)
}
pub fn validate_plan_with_budget(
    requirements: &[Requirement],
    plan: &QuestionPlan,
    budget: ModelBudget,
) -> Result<(), PublicError> {
    if plan.completion_tokens > budget.completion_tokens()
        || plan.prompt_tokens > budget.operation_prompt_tokens()
        || plan.hints.len() != requirements.len()
    {
        return Err(PublicError::InvalidModelOutput);
    }
    if plan.refinements.is_empty() || plan.refinements.len() > MAX_REQUIREMENTS {
        return Err(PublicError::InvalidModelOutput);
    }
    for refinement in &plan.refinements {
        if !requirements.iter().any(|r| r.id == refinement.clause_id)
            || refinement.text.trim().is_empty()
            || refinement.text.chars().count() > 160
            || refinement.text.chars().any(char::is_control)
        {
            return Err(PublicError::InvalidModelOutput);
        }
    }
    for clause in requirements {
        if !plan.refinements.iter().any(|r| {
            r.clause_id == clause.id
                && (clause.kind == RequirementKind::Fact || r.kind == clause.kind)
        }) {
            return Err(PublicError::InvalidModelOutput);
        }
    }
    let mut seen = Vec::new();
    for hints in &plan.hints {
        if !requirements.iter().any(|r| r.id == hints.id)
            || seen.contains(&hints.id)
            || hints.terms.len() > 4
            || hints.terms.iter().any(|t| {
                t.trim().is_empty() || t.chars().count() > 48 || t.chars().any(char::is_control)
            })
        {
            return Err(PublicError::InvalidModelOutput);
        }
        seen.push(hints.id);
    }
    Ok(())
}
pub fn validate_assessment(
    requirements: &[Requirement],
    evidence: &[Evidence],
    value: &Assessment,
) -> Result<(), PublicError> {
    validate_assessment_with_budget(requirements, evidence, value, ModelBudget::Local)
}
pub fn validate_assessment_with_budget(
    requirements: &[Requirement],
    evidence: &[Evidence],
    value: &Assessment,
    budget: ModelBudget,
) -> Result<(), PublicError> {
    if value.completion_tokens > budget.completion_tokens()
        || value.prompt_tokens > budget.operation_prompt_tokens()
        || value.support.len() != requirements.len()
        || value.served_ids.is_empty()
        || value.served_ids.len() > MAX_LEDGER_RANGES
    {
        return Err(PublicError::InvalidModelOutput);
    }
    let mut seen = Vec::new();
    for id in &value.served_ids {
        if !evidence.iter().any(|e| e.id == *id) || seen.contains(id) {
            return Err(PublicError::InvalidModelOutput);
        }
        seen.push(*id);
    }
    seen.clear();
    for row in &value.support {
        if !requirements.iter().any(|r| r.id == row.id)
            || seen.contains(&row.id)
            || row.evidence_ids.len() > MAX_LEDGER_RANGES
            || (row.state.complete() && row.supporting_ids().next().is_none())
            || (matches!(
                row.state,
                SupportState::MissingInformation | SupportState::Unrelated
            ) && row.supporting_ids().next().is_some())
            || (row.state == SupportState::Conflicting && row.evidence_ids.len() < 2)
        {
            return Err(PublicError::InvalidModelOutput);
        }
        if row.state.complete()
            && !requirements
                .iter()
                .any(|r| r.id == row.id && r.kind.accepts(row.basis))
        {
            return Err(PublicError::InvalidModelOutput);
        }
        let requirement = requirements
            .iter()
            .find(|r| r.id == row.id)
            .ok_or(PublicError::InvalidModelOutput)?;
        if row.state.complete() && requirement.kind == RequirementKind::Value {
            let primary = row
                .value_evidence_id
                .and_then(|id| {
                    evidence
                        .iter()
                        .find(|e| e.id == id && value.served_ids.contains(&id))
                })
                .ok_or(PublicError::InvalidModelOutput)?;
            if !value_evidence_compatible(requirement, primary) {
                return Err(PublicError::InvalidModelOutput);
            }
        } else if row.value_evidence_id.is_some() {
            return Err(PublicError::InvalidModelOutput);
        }
        let mut ids = Vec::new();
        for id in &row.evidence_ids {
            if !value.served_ids.contains(id) || ids.contains(id) {
                return Err(PublicError::InvalidModelOutput);
            }
            ids.push(*id);
        }
        seen.push(row.id);
    }
    Ok(())
}
pub fn refine_question(
    clauses: &[Requirement],
    plan: &QuestionPlan,
) -> Result<(Vec<Requirement>, Vec<RequirementHints>), PublicError> {
    refine_question_with_budget(clauses, plan, ModelBudget::Local)
}
pub fn refine_question_with_budget(
    clauses: &[Requirement],
    plan: &QuestionPlan,
    budget: ModelBudget,
) -> Result<(Vec<Requirement>, Vec<RequirementHints>), PublicError> {
    validate_plan_with_budget(clauses, plan, budget)?;
    // Model refinements improve discovery; they cannot create obligations the
    // user never requested or change the core's requested value/result kinds.
    let mut hints = plan.hints.clone();
    let original = clauses
        .iter()
        .map(|r| r.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    for refinement in &plan.refinements {
        let hint = hints
            .iter_mut()
            .find(|h| h.id == refinement.clause_id)
            .ok_or(PublicError::InvalidModelOutput)?;
        for term in crate::corpus::request_terms(&refinement.text) {
            if hint.terms.len() == 4 {
                break;
            }
            let advisory = RequirementHints {
                id: hint.id,
                terms: vec![term.clone()],
            };
            if term.chars().count() <= 48
                && !hint.terms.contains(&term)
                && crate::corpus::validate_expansion_capacity(&original, &[advisory]).is_ok()
            {
                hint.terms.push(term);
            }
        }
    }
    Ok((clauses.to_vec(), hints))
}
pub(crate) fn quoted_phrases(question: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut opened = None;
    for (i, ch) in question.char_indices() {
        if let Some((closing, start)) = opened {
            if ch == closing {
                let text = question[start..i].trim();
                if !text.is_empty() {
                    result.push(text.to_owned());
                }
                opened = None;
            }
        } else if ch == '"' || ch == '“' {
            opened = Some((if ch == '“' { '”' } else { '"' }, i + ch.len_utf8()));
        }
    }
    result
}
