use crate::{NotePath, NoteReadPort, PublicError};
use serde_yaml_ng::Value;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
fn policy_key(value: &str) -> String {
    value
        .nfd()
        .flat_map(char::to_lowercase)
        .case_fold()
        .collect()
}

pub const MAX_INDEX_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_SOURCE_CACHE_BYTES: usize = 64 * 1024 * 1024;
const MAX_INDEX_MILLIS: u64 = 120_000;
const MAX_BLOCKS_PER_NOTE: usize = 1024;
const MAX_DERIVED_TERM_BYTES: usize = 128 * 1024 * 1024;
const MAX_LEXICAL_TERM_CHARS: usize = 64;
const MAX_QUERY_MILLIS: u64 = 5_000;
pub const MAX_RESULTS: usize = 8;
pub const MAX_EXCERPT_CHARS: usize = 1200;
pub const MAX_WINDOW_LINES: usize = 6;
// A short preamble plus a complete list/table may exceed an ordinary window.
// The existing excerpt character and model input budgets still apply.
const MAX_STRUCTURAL_WINDOW_LINES: usize = 24;
const WINDOW_STRIDE: usize = 3;
const MAX_WINDOWS_PER_NOTE: usize = crate::MAX_NOTE_BYTES as usize;
const MAX_RETAINED_WINDOWS_PER_NOTE: usize = 32;
const MAX_RANKED_WINDOWS: usize = 256;
const MAX_QUERY_TERMS: usize = 32;
const BODY_TERM_WEIGHT: usize = 16;
const HEADING_TERM_WEIGHT: usize = 12;
const BODY_PHRASE_WEIGHT: usize = 4;

fn lexical_term(value: &str) -> String {
    let mut value: String = policy_key(value)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();
    if value.len() > 4 && value.ends_with('s') && !value.ends_with("ss") {
        value.pop();
    }
    if value.len() > 5 && value.ends_with("ing") {
        value.truncate(value.len() - 3);
    }
    if value.len() > 3 && value.ends_with('e') {
        value.pop();
    }
    value
}

fn lexical_terms(value: &str) -> Vec<String> {
    value
        .split(|c: char| !c.is_alphanumeric())
        .filter(|value| !value.is_empty())
        .map(lexical_term)
        .collect()
}

fn structural_line(line: &str) -> u8 {
    let line = line.trim_start();
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    if line.starts_with('|') {
        1
    } else if line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || (digits > 0 && (line[digits..].starts_with(". ") || line[digits..].starts_with(") ")))
    {
        2
    } else {
        0
    }
}

fn query_terms(question: &str) -> Vec<String> {
    const GENERIC: &[&str] = &[
        "a", "an", "and", "are", "as", "at", "be", "by", "compare", "complete", "does", "for",
        "from", "how", "in", "is", "it", "list", "of", "on", "or", "should", "the", "their",
        "this", "to", "use", "what", "when", "which", "with", "latest", "question", "earlier", "i",
        "me", "my", "we", "our", "you", "your", "do", "can",
    ];
    let normalized_question = question.replace("'s", "").replace("’s", "");
    let mut terms: Vec<_> = normalized_question
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(policy_key)
        .filter(|s| !GENERIC.contains(&s.as_str()))
        .map(|s| lexical_term(&s))
        .take(MAX_QUERY_TERMS)
        .collect();
    terms.sort();
    terms.dedup();
    terms
}

fn action_query(question: &str) -> bool {
    question
        .split(|c: char| !c.is_alphanumeric())
        .map(policy_key)
        .any(|term| {
            matches!(
                term.as_str(),
                "try" | "should" | "steps" | "methods" | "remedies" | "checklist"
            )
        })
}

// Keep structural passages contiguous with their nearest section framing.
// Ancestor framing is included when bounded; immediate framing is mandatory.
fn structural_context_start(
    lines: &[&str],
    body_start: usize,
    start: usize,
    end: usize,
) -> Option<usize> {
    let fits = |candidate: usize| {
        end.saturating_sub(candidate) <= MAX_STRUCTURAL_WINDOW_LINES
            && lines[candidate..end]
                .iter()
                .map(|line| line.chars().count())
                .sum::<usize>()
                + end.saturating_sub(candidate + 1)
                <= MAX_EXCERPT_CHARS
    };
    let Some(nearest) = (body_start..start)
        .rev()
        .find(|index| lines[*index].starts_with('#'))
    else {
        return fits(body_start).then_some(body_start);
    };
    if !fits(nearest) {
        return None;
    }
    let mut context = nearest;
    let mut depth = lines[nearest].chars().take_while(|ch| *ch == '#').count();
    for index in (body_start..nearest).rev() {
        let parent_depth = lines[index].chars().take_while(|ch| *ch == '#').count();
        if parent_depth > 0 && parent_depth < depth {
            if !fits(index) {
                break;
            }
            context = index;
            depth = parent_depth;
        }
    }
    Some(context)
}

fn windows(
    note: &Note,
    terms: &[String],
    question: &str,
    keyword_search: bool,
) -> Vec<(usize, Evidence)> {
    let action_question = action_query(question);
    let lines: Vec<_> = note.bytes.lines().collect();
    let mut result = Vec::new();
    let mut headings: Vec<String> = Vec::new();
    let heading_positions: Vec<_> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.starts_with('#'))
        .map(|(i, _)| i)
        .collect();
    let block_kind = structural_line;
    let block_positions: Vec<_> = lines
        .iter()
        .enumerate()
        .skip(note.body_start)
        .filter(|(i, line)| {
            !line.trim().is_empty()
                && (*i == note.body_start
                    || lines[i - 1].trim().is_empty()
                    || (block_kind(line) != 0 && block_kind(line) != block_kind(lines[i - 1])))
        })
        .map(|(i, _)| i)
        .collect();
    let mut structural_blocks = Vec::new();
    let mut position = note.body_start;
    while position < lines.len() {
        let kind = block_kind(lines[position]);
        if kind == 0 {
            position += 1;
            continue;
        }
        let start = position;
        while position < lines.len() && block_kind(lines[position]) == kind {
            position += 1;
        }
        structural_blocks.push((start, position));
    }
    let mut block_cursor = 0;
    let mut heading_cursor = 0;
    let discovery = lexical_terms(&note.discovery);
    let path_key = lexical_terms(note.path.as_str());
    let question_key = policy_key(question);
    let phrase_terms: Vec<_> = question
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(lexical_term)
        .filter(|s| terms.contains(s))
        .take(MAX_QUERY_TERMS)
        .collect();
    let mut scanned = 0;
    let mut start = note.body_start;
    while start < lines.len() && scanned < MAX_WINDOWS_PER_NOTE {
        scanned += 1;
        if lines[start].starts_with('#') {
            let depth = lines[start]
                .chars()
                .take_while(|c| *c == '#')
                .count()
                .min(6);
            headings.truncate(depth.saturating_sub(1));
            headings.push(policy_key(lines[start]));
        }
        let heading = headings.join(" ");
        while heading_cursor < heading_positions.len() && heading_positions[heading_cursor] <= start
        {
            heading_cursor += 1;
        }
        let next_heading = heading_positions
            .get(heading_cursor)
            .copied()
            .unwrap_or(lines.len());
        let mut end = (start + MAX_WINDOW_LINES)
            .min(next_heading)
            .min(lines.len());
        let mut content_start = (start..end)
            .find(|i| !lines[*i].trim().is_empty() && !lines[*i].starts_with('#'))
            .unwrap_or(end);
        let mut structure_fits = true;
        let mut block_index = structural_blocks.partition_point(|(_, end)| *end <= content_start);
        let mut expanded_start = content_start;
        let mut expanded_end = end;
        while let Some(&(block_start, block_end)) = structural_blocks.get(block_index) {
            if block_start >= expanded_end {
                break;
            }
            expanded_start = expanded_start.min(block_start);
            expanded_end = expanded_end.max(block_end);
            if expanded_end - expanded_start > MAX_STRUCTURAL_WINDOW_LINES {
                structure_fits = false;
                break;
            }
            block_index += 1;
        }
        if structure_fits {
            structure_fits = expanded_end - expanded_start <= MAX_STRUCTURAL_WINDOW_LINES
                && lines[expanded_start..expanded_end]
                    .iter()
                    .map(|line| line.chars().count())
                    .sum::<usize>()
                    + expanded_end.saturating_sub(expanded_start + 1)
                    <= MAX_EXCERPT_CHARS;
        }
        if structure_fits {
            content_start = expanded_start;
            end = expanded_end;
        }
        // Ranking uses the original passage, so contextual prefixes do not
        // receive body weight in addition to existing heading weighting.
        let ranked_start = content_start;
        let structural = lines[content_start..end]
            .iter()
            .any(|line| structural_line(line) != 0);
        if structure_fits && structural {
            match structural_context_start(&lines, note.body_start, content_start, end) {
                Some(context_start) => content_start = context_start,
                None => structure_fits = false,
            }
        }
        let selected = &lines[ranked_start..end];
        let text = lines[content_start..end].join("\n");
        let body = lexical_terms(
            &crate::chat::factual_prose_lines(&selected.join("\n"), &question_key).join(" "),
        );
        let body_score = terms.iter().filter(|t| body.contains(t)).count();
        let raw_body = lexical_terms(&selected.join(" "));
        let weak_discovery_score = terms.iter().filter(|t| raw_body.contains(t)).count();
        let heading = lexical_terms(&heading);
        let heading_score = terms.iter().filter(|t| heading.contains(t)).count();
        let discovery_score = terms
            .iter()
            .filter(|t| discovery.contains(t) || path_key.contains(t))
            .count();
        // Question-only and navigation windows remain discoverable but cannot
        // outrank passages containing declarative body evidence.
        let factual = !body.is_empty();
        let score = if factual {
            body_score * BODY_TERM_WEIGHT
                + heading_score * HEADING_TERM_WEIGHT
                + discovery_score
                + weak_discovery_score
                + phrase_terms
                    .windows(2)
                    .filter(|pair| body.windows(2).any(|window| window == *pair))
                    .count()
                    * BODY_PHRASE_WEIGHT
        } else if keyword_search {
            weak_discovery_score + discovery_score + heading_score
        } else {
            0
        };
        let structural_companion = action_question
            && selected
                .iter()
                .filter(|line| structural_line(line) != 0)
                .count()
                >= 2;
        if structure_fits
            && (score > 0 || structural_companion)
            && text.chars().count() <= MAX_EXCERPT_CHARS
        {
            result.push((
                score,
                Evidence {
                    id: 0,
                    path: note.path.clone(),
                    start_line: content_start + 1,
                    end_line: end,
                    text,
                },
            ));
            result.sort_by(|a, b| {
                b.0.cmp(&a.0)
                    .then_with(|| a.1.start_line.cmp(&b.1.start_line))
            });
            result.truncate(MAX_RETAINED_WINDOWS_PER_NOTE);
        }
        while block_cursor < block_positions.len() && block_positions[block_cursor] <= start {
            block_cursor += 1;
        }
        let next_block = block_positions
            .get(block_cursor)
            .copied()
            .unwrap_or(lines.len());
        start = (start + WINDOW_STRIDE).min(next_heading).min(next_block);
    }
    // A relevant diagnosis can lead to a procedure whose own wording has no
    // query overlap. Keep bounded structural companions only when this note
    // contains a positively ranked passage; unrelated notes stay absent.
    if !result.iter().any(|(score, _)| *score > 0) {
        result.clear();
    }
    result
}

#[derive(Clone)]
pub struct AccessPolicy {
    pub instructions: NotePath,
    pub research: NotePath,
    pub folders: Vec<String>,
    pub tags: Vec<String>,
}
impl Default for AccessPolicy {
    fn default() -> Self {
        Self {
            instructions: NotePath::parse("Synapse/Instructions.md")
                .unwrap_or_else(|_| unreachable!()),
            research: NotePath::parse("Research.md").unwrap_or_else(|_| unreachable!()),
            folders: Vec::new(),
            tags: Vec::new(),
        }
    }
}
impl AccessPolicy {
    pub fn validate(&self) -> Result<(), PublicError> {
        const MAX_EXCLUSIONS: usize = 128;
        if policy_key(self.instructions.as_str()) == policy_key(self.research.as_str())
            || [&self.instructions, &self.research]
                .iter()
                .any(|path| path.as_str().split('/').any(|part| part.starts_with('.')))
            || self.folders.len() > MAX_EXCLUSIONS
            || self.tags.len() > MAX_EXCLUSIONS
            || self
                .tags
                .iter()
                .any(|tag| tag.trim().is_empty() || tag.chars().count() > 64)
            || self
                .folders
                .iter()
                .any(|folder| NotePath::parse(&format!("{folder}/validation.md")).is_err())
        {
            return Err(PublicError::AccessRefused);
        }
        Ok(())
    }
    pub fn permits_directory(&self, path: &str) -> bool {
        let key = policy_key(path);
        !path.split('/').any(|part| part.starts_with('.'))
            && !self.folders.iter().any(|folder| {
                let excluded = policy_key(folder);
                key == excluded || key.starts_with(&format!("{excluded}/"))
            })
    }
    pub fn permits_path(&self, path: &NotePath) -> bool {
        let key = policy_key(path.as_str());
        key != policy_key(self.instructions.as_str())
            && key != policy_key(self.research.as_str())
            && self.permits_directory(path.as_str())
    }
}
#[derive(Clone)]
pub struct Evidence {
    pub id: usize,
    pub path: NotePath,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}
struct Note {
    path: NotePath,
    bytes: String,
    body_start: usize,
    discovery: String,
    modified: u64,
    blocks: Vec<crate::SourceBlock>,
    source_hash: [u8; 32],
    links: Vec<NotePath>,
}
pub struct Corpus {
    notes: Vec<Note>,
    attention: Vec<NotePath>,
    policy: AccessPolicy,
    index: Option<std::sync::Arc<dyn crate::SearchIndexPort>>,
    parsed_notes: usize,
    reused_notes: usize,
}
fn retain_note(
    notes: &mut Vec<Note>,
    note: Note,
    metadata_bytes: &mut usize,
) -> Result<(), PublicError> {
    let bytes = std::mem::size_of::<Note>()
        + note.path.as_str().len()
        + note.blocks.capacity() * std::mem::size_of::<crate::SourceBlock>()
        + note.discovery.capacity()
        + note.links.capacity() * std::mem::size_of::<NotePath>()
        + note.links.iter().map(|p| p.as_str().len()).sum::<usize>()
        + note
            .blocks
            .iter()
            .map(|b| b.headings.capacity() * std::mem::size_of::<usize>())
            .sum::<usize>();
    *metadata_bytes = metadata_bytes.saturating_add(bytes);
    if *metadata_bytes > MAX_SOURCE_CACHE_BYTES {
        return Err(PublicError::ResourceLimit);
    }
    notes.push(note);
    Ok(())
}
impl Corpus {
    pub fn build(reader: &impl NoteReadPort, policy: AccessPolicy) -> Result<Self, PublicError> {
        Self::build_with_index(reader, policy, None)
    }
    pub fn build_with_index(
        reader: &impl NoteReadPort,
        policy: AccessPolicy,
        index: Option<std::sync::Arc<dyn crate::SearchIndexPort>>,
    ) -> Result<Self, PublicError> {
        let started = reader.monotonic_millis();
        let fingerprint = crate::policy_fingerprint(&policy);
        let cached = if let Some(index) = &index {
            index.load(fingerprint.as_str())?
        } else {
            Vec::new()
        };
        let mut updates = Vec::new();
        let mut parsed_notes = 0;
        let mut derived_term_bytes = 0usize;
        let mut cache_bytes = 0;
        let mut metadata_bytes = 0;
        let mut notes = Vec::new();
        let mut attention = Vec::new();
        let paths = reader.list_notes()?;
        let mut bytes_used = paths.iter().map(|path| path.as_str().len()).sum::<usize>()
            + paths.capacity() * std::mem::size_of::<NotePath>();
        if bytes_used > MAX_INDEX_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        for path in paths {
            if reader.monotonic_millis().saturating_sub(started) > MAX_INDEX_MILLIS {
                return Err(PublicError::ResourceLimit);
            }
            if !policy.permits_path(&path) {
                continue;
            }
            let bytes = match reader.read_note(&path) {
                Ok(bytes) => bytes,
                Err(PublicError::InvalidMetadata | PublicError::ResourceLimit) => {
                    attention.push(path);
                    continue;
                }
                Err(error) => return Err(error),
            };
            bytes_used += bytes.len();
            if bytes_used > MAX_INDEX_BYTES {
                return Err(PublicError::ResourceLimit);
            }
            use sha2::{Digest, Sha256};
            let source_hash: [u8; 32] = Sha256::digest(bytes.as_bytes()).into();
            if let Some(prior) = cached.iter().find(|entry| {
                entry.path == path
                    && entry.hash == source_hash
                    && valid_cached_source(entry, &bytes)
            }) {
                let mut retained = bytes;
                cache_bytes += retained.capacity();
                if cache_bytes > MAX_SOURCE_CACHE_BYTES {
                    retained = String::new();
                }
                retain_note(
                    &mut notes,
                    Note {
                        path,
                        bytes: retained,
                        body_start: prior.body_start,
                        discovery: prior.discovery.clone(),
                        modified: reader.modified_note(&prior.path).unwrap_or(0),
                        links: prior.links.clone(),
                        blocks: prior.blocks.clone(),
                        source_hash,
                    },
                    &mut metadata_bytes,
                )?;
                continue;
            }
            let Some((metadata, body_start)) = metadata(&bytes) else {
                attention.push(path);
                continue;
            };
            if ignored(&metadata) || excluded_tags(&metadata, &policy) {
                continue;
            }
            let Some(discovery) = discovery(&metadata, &policy) else {
                attention.push(path);
                continue;
            };
            let modified = reader.modified_note(&path).unwrap_or(0);
            let links = links(&bytes, &path);
            bytes_used += discovery.len()
                + links.iter().map(|link| link.as_str().len()).sum::<usize>()
                + links.capacity() * std::mem::size_of::<NotePath>()
                + 2 * std::mem::size_of::<Note>();
            if bytes_used > MAX_INDEX_BYTES {
                return Err(PublicError::ResourceLimit);
            }
            let blocks = crate::source_blocks(&bytes, body_start);
            if blocks.len() > MAX_BLOCKS_PER_NOTE {
                return Err(PublicError::ResourceLimit);
            }
            bytes_used += blocks.capacity() * std::mem::size_of::<crate::SourceBlock>()
                + blocks
                    .iter()
                    .map(|block| block.headings.capacity() * std::mem::size_of::<usize>())
                    .sum::<usize>();
            if bytes_used > MAX_INDEX_BYTES {
                return Err(PublicError::ResourceLimit);
            }
            if notes.len() >= crate::MAX_INDEXED_NOTES {
                return Err(PublicError::ResourceLimit);
            }
            parsed_notes += 1;
            if index.is_some() {
                let mut indexed_blocks = Vec::new();
                for (i, block) in blocks.iter().enumerate() {
                    let mut terms = lexical_terms(&bytes[block.bytes.clone()]);
                    for ancestor in &block.headings {
                        terms.extend(lexical_terms(&bytes[blocks[*ancestor].bytes.clone()]));
                    }
                    terms.extend(lexical_terms(&discovery));
                    terms.retain(|term| term.chars().count() <= MAX_LEXICAL_TERM_CHARS);
                    let terms = terms.join(" ");
                    derived_term_bytes = derived_term_bytes.saturating_add(terms.len());
                    if derived_term_bytes > MAX_DERIVED_TERM_BYTES {
                        return Err(PublicError::ResourceLimit);
                    }
                    indexed_blocks.push((i, terms));
                }
                updates.push(crate::IndexTerms {
                    path: path.clone(),
                    blocks: indexed_blocks,
                });
            }
            let mut bytes = bytes;
            cache_bytes += bytes.capacity();
            if cache_bytes > MAX_SOURCE_CACHE_BYTES {
                bytes = String::new();
            }
            retain_note(
                &mut notes,
                Note {
                    blocks,
                    source_hash,
                    modified,
                    links,
                    path,
                    bytes,
                    body_start,
                    discovery,
                },
                &mut metadata_bytes,
            )?;
        }
        if reader.monotonic_millis().saturating_sub(started) > MAX_INDEX_MILLIS {
            return Err(PublicError::ResourceLimit);
        }
        let reused_notes = notes.len().saturating_sub(parsed_notes);
        let mut retained_bytes =
            metadata_bytes + notes.iter().map(|n| n.bytes.capacity()).sum::<usize>();
        for note in notes.iter_mut().rev() {
            if retained_bytes <= MAX_SOURCE_CACHE_BYTES {
                break;
            }
            retained_bytes = retained_bytes.saturating_sub(note.bytes.capacity());
            note.bytes = String::new();
        }
        if notes.len() > crate::MAX_INDEXED_NOTES {
            return Err(PublicError::ResourceLimit);
        }
        if let Some(index) = &index {
            let records: Vec<_> = notes
                .iter()
                .map(|note| crate::IndexedSource {
                    path: note.path.clone(),
                    hash: note.source_hash,
                    blocks: note.blocks.clone(),
                    body_start: note.body_start,
                    discovery: note.discovery.clone(),
                    links: note.links.clone(),
                })
                .collect();
            index.publish(fingerprint.as_str(), &records, &updates)?;
        }
        Ok(Self {
            notes,
            attention,
            policy,
            index,
            parsed_notes,
            reused_notes,
        })
    }
    /// Polling invalidation: discard the old generation on each refresh. No stale
    /// evidence is returned between refreshes because query rechecks exact bytes.
    pub fn refresh(
        &mut self,
        reader: &impl NoteReadPort,
        policy: AccessPolicy,
    ) -> Result<(), PublicError> {
        let replacement = Self::build_with_index(reader, policy, self.index.clone())?;
        *self = replacement;
        Ok(())
    }
    pub fn linked(
        &self,
        path: &NotePath,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<NotePath> {
        let Some(source) = self
            .notes
            .iter()
            .find(|note| &note.path == path && self.current(note, reader, policy))
        else {
            return Vec::new();
        };
        let mut result: Vec<_> = self
            .notes
            .iter()
            .filter(|note| {
                &note.path != path
                    && (note.links.contains(path) || source.links.contains(&note.path))
                    && self.current(note, reader, policy)
            })
            .take(MAX_RESULTS)
            .map(|note| note.path.clone())
            .collect();
        result.sort();
        result.dedup();
        result.truncate(MAX_RESULTS);
        result
    }
    pub fn recent(&self, reader: &impl NoteReadPort, policy: &AccessPolicy) -> Vec<NotePath> {
        let mut notes: Vec<_> = self
            .notes
            .iter()
            .filter(|note| self.current(note, reader, policy))
            .collect();
        notes.sort_by(|a, b| {
            b.modified
                .cmp(&a.modified)
                .then_with(|| a.path.cmp(&b.path))
        });
        notes
            .into_iter()
            .take(MAX_RESULTS)
            .map(|note| note.path.clone())
            .collect()
    }
    fn current(&self, note: &Note, reader: &impl NoteReadPort, policy: &AccessPolicy) -> bool {
        if !self.policy.permits_path(&note.path) || !policy.permits_path(&note.path) {
            return false;
        }
        let Ok(bytes) = reader.read_note(&note.path) else {
            return false;
        };
        use sha2::{Digest, Sha256};
        if <[u8; 32]>::from(Sha256::digest(bytes.as_bytes())) != note.source_hash {
            return false;
        }
        if crate::policy_fingerprint(policy) == crate::policy_fingerprint(&self.policy) {
            return true;
        }
        metadata(&bytes)
            .is_some_and(|(meta, _)| !ignored(&meta) && discovery(&meta, policy).is_some())
    }
    pub fn attention(&self, reader: &impl NoteReadPort, policy: &AccessPolicy) -> Vec<NotePath> {
        self.attention
            .iter()
            .filter(|path| {
                if !policy.permits_path(path) {
                    return false;
                }
                let Ok(bytes) = reader.read_note(path) else {
                    return false;
                };
                match metadata(&bytes) {
                    Some((meta, _)) => {
                        !ignored(&meta)
                            && !excluded_tags(&meta, policy)
                            && discovery(&meta, policy).is_none()
                    }
                    None => true,
                }
            })
            .cloned()
            .collect()
    }
    pub fn passage_for(
        &self,
        path: &NotePath,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Option<Evidence> {
        let note = self
            .notes
            .iter()
            .find(|note| &note.path == path && self.current(note, reader, policy))?;
        let lines: Vec<_> = note.bytes.lines().skip(note.body_start).take(6).collect();
        let text = lines.join("\n");
        if text.trim().is_empty() || text.chars().count() > MAX_EXCERPT_CHARS {
            return None;
        }
        Some(Evidence {
            id: 1,
            path: path.clone(),
            start_line: note.body_start + 1,
            end_line: note.body_start + lines.len(),
            text,
        })
    }
    pub fn reconciliation_counts(&self) -> (usize, usize) {
        (self.parsed_notes, self.reused_notes)
    }
    pub fn search_checked(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<Evidence>, PublicError> {
        let Some(index) = &self.index else {
            let started = reader.monotonic_millis();
            let result = self.search(question, reader, policy);
            if reader.monotonic_millis().saturating_sub(started) > MAX_QUERY_MILLIS {
                return Err(PublicError::ResourceLimit);
            }
            return Ok(result);
        };
        let hits = index.candidates(
            crate::policy_fingerprint(policy).as_str(),
            &query_terms(question),
        )?;
        let mut result = Vec::new();
        let mut seen_notes = Vec::new();
        for hit in hits {
            if seen_notes.contains(&hit.path) {
                continue;
            }
            let Some(note) = self
                .notes
                .iter()
                .find(|n| n.path == hit.path && n.source_hash == hit.hash)
            else {
                continue;
            };
            if !self.current(note, reader, policy) {
                continue;
            }
            let Some(block) = note.blocks.get(hit.block) else {
                return Err(PublicError::StateUnavailable);
            };
            let source = reader.read_note(&note.path)?;
            if let Some(mut evidence) = block.evidence(&source, &note.path) {
                evidence.id = result.len() + 1;
                if verify_evidence(reader, policy, &evidence) {
                    seen_notes.push(hit.path.clone());
                    result.push(evidence);
                }
                if result.len() == MAX_RESULTS {
                    break;
                }
            }
        }
        Ok(result)
    }
    pub fn note_count(&self) -> usize {
        self.notes.len()
    }
    /// Focus link expansion on the current question rather than the note lead.
    pub fn query_note(
        &self,
        path: &NotePath,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<Evidence> {
        if question.len() > 4096 {
            return Vec::new();
        }
        let Some(note) = self
            .notes
            .iter()
            .find(|note| &note.path == path && self.current(note, reader, policy))
        else {
            return Vec::new();
        };
        windows(note, &query_terms(question), question, false)
            .into_iter()
            .take(MAX_RESULTS)
            .enumerate()
            .map(|(i, (_, mut e))| {
                e.id = i + 1;
                e
            })
            .collect()
    }
    /// Resolve packets against current source bytes and policy. Index-derived
    /// coordinates cannot independently authorize a source projection.
    pub fn resolve_packets(
        &self,
        packets: &[crate::EvidencePacket],
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<Evidence>, PublicError> {
        if packets.len() > crate::MAX_CANDIDATE_PACKETS {
            return Err(PublicError::ResourceLimit);
        }
        let mut identities = Vec::new();
        let mut result = Vec::new();
        for packet in packets {
            if packet.companions.len() >= crate::MAX_PACKET_RANGES {
                return Err(PublicError::ResourceLimit);
            }
            let note = self
                .notes
                .iter()
                .find(|note| {
                    note.path == packet.path
                        && note.source_hash == packet.source_hash
                        && self.current(note, reader, policy)
                })
                .ok_or(PublicError::AccessRefused)?;
            let source = reader.read_note(&note.path)?;
            for block in std::iter::once(&packet.primary).chain(&packet.companions) {
                // Public packet values may be modified by a caller. Resolve
                // only an exact block in this immutable source generation.
                let raw = source
                    .get(block.bytes.clone())
                    .ok_or(PublicError::AccessRefused)?;
                let start_line = source[..block.bytes.start]
                    .bytes()
                    .filter(|b| *b == b'\n')
                    .count()
                    + 1;
                let end_line = source[..block.bytes.end]
                    .bytes()
                    .filter(|b| *b == b'\n')
                    .count()
                    + 1;
                use sha2::{Digest, Sha256};
                if start_line <= note.body_start
                    || start_line != block.start_line
                    || end_line != block.end_line
                    || <[u8; 32]>::from(Sha256::digest(raw.as_bytes())) != block.hash
                {
                    return Err(PublicError::AccessRefused);
                }
                let verified = block;
                let identity = (note.source_hash, verified.bytes.clone());
                if identities.contains(&identity) {
                    continue;
                }
                if let Some(mut evidence) = verified.evidence(&source, &note.path) {
                    identities.push(identity);
                    evidence.id = result.len() + 1;
                    result.push(evidence);
                }
            }
        }
        Ok(result)
    }
    /// Bounded source-preserving retrieval, including companions in represented
    /// notes. Packet identity never depends on local model ordinals.
    pub fn query_packets(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        self.ranked_packets(question, question, false, None, reader, policy)
    }
    pub fn query_packets_for_question(
        &self,
        terms: &str,
        original: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        self.ranked_packets(terms, original, false, None, reader, policy)
    }
    /// Follow-up retrieval remains permitted inside an already represented
    /// note. A prior excerpt must still be authentic before its note is used.
    pub fn followup_packets(
        &self,
        represented: &Evidence,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        if !verify_evidence(reader, policy, represented)
            || !self
                .notes
                .iter()
                .any(|note| note.path == represented.path && self.current(note, reader, policy))
        {
            return Err(PublicError::AccessRefused);
        }
        self.ranked_packets(
            question,
            question,
            false,
            Some(&represented.path),
            reader,
            policy,
        )
    }
    /// Follow only application-resolved Markdown links/backlinks. Relationships
    /// authorize discovery of permitted blocks, never factual support.
    pub fn related_packets(
        &self,
        represented: &Evidence,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        if !verify_evidence(reader, policy, represented) {
            return Err(PublicError::AccessRefused);
        }
        let source = self
            .notes
            .iter()
            .find(|n| n.path == represented.path && self.current(n, reader, policy))
            .ok_or(PublicError::AccessRefused)?;
        let mut result = Vec::new();
        for target in self
            .notes
            .iter()
            .filter(|n| {
                n.path != source.path
                    && (source.links.contains(&n.path) || n.links.contains(&source.path))
            })
            .take(MAX_RESULTS)
        {
            if !self.current(target, reader, policy) {
                continue;
            }
            let mut packets = self.ranked_packets(
                question,
                question,
                false,
                Some(&target.path),
                reader,
                policy,
            )?;
            if packets.is_empty() {
                let text = reader.read_note(&target.path)?;
                for (i, block) in target
                    .blocks
                    .iter()
                    .enumerate()
                    .filter(|(_, b)| b.kind != crate::BlockKind::Heading)
                    .take(crate::MAX_PACKET_RANGES)
                {
                    if block.evidence(&text, &target.path).is_some() {
                        packets.push(crate::source_blocks::packet(
                            &target.path,
                            target.source_hash,
                            &target.blocks,
                            &text,
                            target.body_start,
                            i,
                        ));
                    }
                }
            }
            for packet in packets {
                if result.len() == 16 {
                    return Ok(result);
                }
                result.push(packet);
            }
        }
        Ok(result)
    }
    pub fn query_phrase_packets(
        &self,
        phrase: &str,
        original: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        self.ranked_packets(phrase, original, true, None, reader, policy)
    }
    fn ranked_packets(
        &self,
        question: &str,
        original: &str,
        phrase: bool,
        within: Option<&NotePath>,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<crate::EvidencePacket>, PublicError> {
        if question.len() > 4096 {
            return Ok(Vec::new());
        }
        let terms = if phrase {
            lexical_terms(question)
        } else {
            query_terms(question)
        };
        if terms.len() > MAX_QUERY_TERMS {
            return Err(PublicError::ContextOverflow);
        }
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let hits = match (&self.index, within) {
            (Some(index), None) => Some(if phrase {
                index.phrase_candidates(crate::policy_fingerprint(policy).as_str(), &terms)?
            } else {
                index.candidates(crate::policy_fingerprint(policy).as_str(), &terms)?
            }),
            _ => None,
        };
        let mut ranked: Vec<(usize, &Note, usize)> = Vec::new();
        let started = reader.monotonic_millis();
        for note in &self.notes {
            if reader.monotonic_millis().saturating_sub(started) > MAX_QUERY_MILLIS {
                return Err(PublicError::ResourceLimit);
            }
            if hits.as_ref().is_some_and(|hits| {
                !hits
                    .iter()
                    .any(|hit| hit.path == note.path && hit.hash == note.source_hash)
            }) {
                continue;
            }
            if within.is_some_and(|path| path != &note.path) || !self.current(note, reader, policy)
            {
                continue;
            }
            if hits.as_ref().is_some_and(|hits| {
                !hits
                    .iter()
                    .any(|hit| hit.path == note.path && hit.hash == note.source_hash)
            }) {
                continue;
            }
            let Ok(source) = reader.read_note(&note.path) else {
                continue;
            };
            for (index, block) in note.blocks.iter().enumerate() {
                if hits.as_ref().is_some_and(|hits| {
                    !hits.iter().any(|hit| {
                        hit.path == note.path && hit.hash == note.source_hash && hit.block == index
                    })
                }) {
                    continue;
                }
                if block.kind == crate::BlockKind::Heading
                    && source[block.bytes.clone()].starts_with('#')
                {
                    continue;
                }
                let raw = &source[block.bytes.clone()];
                let question_prefix = original
                    .trim()
                    .trim_end_matches(['?', '.', ';'])
                    .to_lowercase();
                let lower = raw.to_lowercase();
                let factual = if [
                    "what ", "does ", "did ", "how ", "when ", "which ", "compare ",
                ]
                .iter()
                .any(|p| question_prefix.starts_with(p))
                    && lower.starts_with(&question_prefix)
                    && !question_prefix.is_empty()
                {
                    continue;
                } else {
                    raw
                };
                let prose = crate::chat::factual_prose_lines(factual, original).join(" ");
                if prose.trim().is_empty() {
                    continue;
                }
                let body = lexical_terms(&prose);
                let heading = block
                    .headings
                    .iter()
                    .map(|i| &source[note.blocks[*i].bytes.clone()])
                    .collect::<Vec<_>>()
                    .join(" ");
                let heading = lexical_terms(&heading);
                if phrase && !policy_key(raw).contains(&policy_key(question)) {
                    continue;
                }
                let discovery_terms = lexical_terms(&note.discovery);
                let discovery_score = terms.iter().filter(|t| discovery_terms.contains(t)).count();
                let raw_terms = lexical_terms(factual);
                let score = discovery_score
                    + terms.iter().filter(|term| raw_terms.contains(term)).count()
                    + terms.iter().filter(|term| body.contains(term)).count() * BODY_TERM_WEIGHT
                    + terms.iter().filter(|term| heading.contains(term)).count()
                        * HEADING_TERM_WEIGHT;
                if score == 0 || block.evidence(&source, &note.path).is_none() {
                    continue;
                }
                if let Some((_, prior_note, prior_index)) =
                    ranked.iter_mut().find(|(_, prior_note, prior_index)| {
                        prior_note.source_hash == note.source_hash
                            && prior_note.blocks[*prior_index].bytes == block.bytes
                    })
                {
                    if note.path < prior_note.path {
                        *prior_note = note;
                        *prior_index = index;
                    }
                    continue;
                }
                ranked.push((score, note, index));
                ranked.sort_by(|a, b| {
                    b.0.cmp(&a.0)
                        .then_with(|| a.1.path.cmp(&b.1.path))
                        .then_with(|| a.2.cmp(&b.2))
                });
                ranked.truncate(crate::MAX_CANDIDATE_PACKETS);
            }
        }
        ranked.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.path.cmp(&b.1.path))
                .then_with(|| a.2.cmp(&b.2))
        });
        let mut result: Vec<crate::EvidencePacket> = Vec::new();
        for (_, note, index) in ranked {
            if result.len() == crate::MAX_CANDIDATE_PACKETS {
                break;
            }
            let primary = &note.blocks[index];
            if result.iter().any(|prior| {
                prior.source_hash == note.source_hash && prior.primary.bytes == primary.bytes
            }) {
                continue;
            }
            let Ok(source) = reader.read_note(&note.path) else {
                continue;
            };
            result.push(crate::source_blocks::packet(
                &note.path,
                note.source_hash,
                &note.blocks,
                &source,
                note.body_start,
                index,
            ));
        }
        Ok(result)
    }
    pub fn query(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<Evidence> {
        self.ranked_query(question, reader, policy, false)
    }
    /// Add planned domain concepts without changing the original question used
    /// to filter repeated prompts. Preserve original lexical terms under the
    /// existing bound; fail explicitly if none of the new concepts can fit.
    pub fn query_planned(
        &self,
        question: &str,
        planned: &[String],
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Result<Vec<Evidence>, PublicError> {
        let mut terms = query_terms(question);
        let additional = query_terms(&planned.join(" "));
        let mut missing = false;
        let mut added = false;
        for term in additional {
            if terms.contains(&term) {
                continue;
            }
            missing = true;
            if terms.len() < MAX_QUERY_TERMS {
                terms.push(term);
                added = true;
            }
        }
        if missing && !added {
            return Err(PublicError::ContextOverflow);
        }
        Ok(self.ranked_query_terms(question, reader, policy, false, &terms))
    }
    /// Lexical discovery may return navigation-only body matches. These search
    /// results are not a model declaration of factual answer sufficiency.
    pub fn search(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<Evidence> {
        self.ranked_query(question, reader, policy, true)
    }
    fn ranked_query(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
        keyword_search: bool,
    ) -> Vec<Evidence> {
        let terms = query_terms(question);
        self.ranked_query_terms(question, reader, policy, keyword_search, &terms)
    }
    fn ranked_query_terms(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
        keyword_search: bool,
        terms: &[String],
    ) -> Vec<Evidence> {
        if question.len() > 4096 || terms.is_empty() {
            return Vec::new();
        }
        let mut candidates = Vec::new();
        let started = reader.monotonic_millis();
        for note in &self.notes {
            if reader.monotonic_millis().saturating_sub(started) > MAX_QUERY_MILLIS {
                break;
            }
            // Fresh bytes and policy, including frontmatter/tag access, are checked
            // before projecting any text. A change requires rebuilding the corpus.
            if !self.policy.permits_path(&note.path) || !policy.permits_path(&note.path) {
                continue;
            }
            let Ok(current) = reader.read_note(&note.path) else {
                continue;
            };
            if current != note.bytes {
                continue;
            }
            let Some((meta, _)) = metadata(&current) else {
                continue;
            };
            if ignored(&meta) || discovery(&meta, policy).is_none() {
                continue;
            }
            candidates.extend(windows(note, terms, question, keyword_search));
            candidates.sort_by(|a, b| {
                b.0.cmp(&a.0)
                    .then_with(|| a.1.path.cmp(&b.1.path))
                    .then_with(|| a.1.start_line.cmp(&b.1.start_line))
            });
            candidates.truncate(MAX_RANKED_WINDOWS);
        }
        candidates.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.path.cmp(&b.1.path))
                .then_with(|| a.1.start_line.cmp(&b.1.start_line))
        });
        let mut selected: Vec<Evidence> = Vec::new();
        let action_question = action_query(question);
        // First preserve the strongest window from each note, then additional
        // sections. Exact duplicates and fully contained windows add no evidence.
        for diversify in [true, false] {
            for (_, candidate) in &candidates {
                if selected.len() == MAX_RESULTS {
                    break;
                }
                let structural_items: Vec<_> = candidate
                    .text
                    .lines()
                    .enumerate()
                    .filter(|(_, line)| structural_line(line) != 0)
                    .map(|(offset, _)| candidate.start_line + offset)
                    .collect();
                let redundant_structure = action_question
                    && structural_items.len() >= 2
                    && structural_items.iter().all(|line| {
                        selected.iter().any(|e| {
                            e.path == candidate.path && e.start_line <= *line && e.end_line >= *line
                        })
                    });
                if redundant_structure
                    || selected.iter().any(|e| {
                        e.path == candidate.path
                            && (diversify
                                || (e.start_line <= candidate.start_line
                                    && e.end_line >= candidate.end_line))
                    })
                {
                    continue;
                }
                let mut candidate = candidate.clone();
                candidate.id = selected.len() + 1;
                let source_path = candidate.path.clone();
                selected.push(candidate);
                if diversify && action_question && selected.len() < MAX_RESULTS {
                    // A diagnosis and its nearby bounded procedure/list can be
                    // complementary evidence. Preserve one such continuation
                    // before unrelated-note diversification fills the budget.
                    if let Some((_, continuation)) = candidates.iter().find(|(_, continuation)| {
                        continuation.path == source_path
                            && continuation
                                .text
                                .lines()
                                .filter(|line| structural_line(line) != 0)
                                .count()
                                >= 2
                            && continuation.text.lines().enumerate().any(|(offset, line)| {
                                structural_line(line) != 0
                                    && !selected.iter().any(|prior| {
                                        let line = continuation.start_line + offset;
                                        prior.path == continuation.path
                                            && prior.start_line <= line
                                            && prior.end_line >= line
                                    })
                            })
                    }) {
                        let mut continuation = continuation.clone();
                        continuation.id = selected.len() + 1;
                        selected.push(continuation);
                    }
                }
            }
        }
        selected
    }
}
pub(crate) fn metadata(bytes: &str) -> Option<(Value, usize)> {
    let bytes = bytes.strip_prefix('\u{feff}').unwrap_or(bytes);
    let mut lines = bytes.lines();
    if lines.next()?.trim_end_matches([' ', '\t']) != "---" {
        return None;
    }
    let mut yaml = String::new();
    let mut count = 1;
    for line in lines {
        count += 1;
        if line.trim_end_matches([' ', '\t']) == "---" {
            return Some((crate::bounded_yaml::parse(&yaml)?, count));
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    None
}
pub(crate) fn ignored(value: &Value) -> bool {
    ["synapse", "vault-synapse"].iter().any(|key| {
        value.get(*key).is_some_and(|value| {
            value.as_str() == Some("ignore")
                || value.get("ignore").and_then(Value::as_bool) == Some(true)
        })
    })
}

pub(crate) fn discovery(meta: &Value, policy: &AccessPolicy) -> Option<String> {
    let description = meta.get("description")?.as_str()?;
    if description.trim().is_empty() || description.chars().count() > 240 {
        return None;
    }
    let tags = strings(meta.get("tags")?, 1, 12, 64)?;
    if tags.iter().any(|tag| policy.tags.contains(tag)) {
        return None;
    }
    let aliases = strings(meta.get("aliases")?, 0, 12, 80)?;
    Some(format!(
        "{description} {} {}",
        tags.join(" "),
        aliases.join(" ")
    ))
}
pub(crate) fn strings(value: &Value, min: usize, max: usize, width: usize) -> Option<Vec<String>> {
    let sequence = value.as_sequence()?;
    if sequence.len() < min || sequence.len() > max {
        return None;
    }
    sequence
        .iter()
        .map(|v| {
            let text = v.as_str()?;
            if text.trim().is_empty() || text.chars().count() > width {
                None
            } else {
                Some(text.to_owned())
            }
        })
        .collect()
}

pub(crate) fn excluded_tags(meta: &Value, policy: &AccessPolicy) -> bool {
    meta.get("tags")
        .and_then(Value::as_sequence)
        .is_some_and(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .any(|tag| policy.tags.iter().any(|excluded| excluded == tag))
        })
}

fn links(bytes: &str, source: &NotePath) -> Vec<NotePath> {
    let mut links = Vec::new();
    for (open, close) in [("[[", "]]"), ("](", ")")] {
        for tail in bytes.split(open).skip(1).take(128) {
            let Some(target) = tail.split(close).next() else {
                continue;
            };
            let target = target.split(['#', '|']).next().unwrap_or("");
            if target.is_empty() || target.contains("://") {
                continue;
            }
            let target = if target.ends_with(".md") {
                target.to_owned()
            } else if open == "[[" {
                format!("{target}.md")
            } else {
                continue;
            };
            let prefix = source
                .as_str()
                .rsplit_once('/')
                .map(|(parent, _)| format!("{parent}/"))
                .unwrap_or_default();
            if let Ok(path) = NotePath::parse(&format!("{prefix}{target}")) {
                links.push(path);
            }
        }
    }
    links.sort();
    links.dedup();
    links.truncate(128);
    links.shrink_to_fit();
    links
}

/// Revalidate application-owned coordinates at every model/output boundary.
pub fn verify_evidence(
    reader: &impl NoteReadPort,
    policy: &AccessPolicy,
    evidence: &Evidence,
) -> bool {
    if evidence.text.trim().is_empty()
        || evidence.id == 0
        || evidence.id > crate::MAX_CANDIDATE_RANGES
        || !policy.permits_path(&evidence.path)
        || evidence.start_line == 0
        || evidence.end_line < evidence.start_line
        || evidence.end_line - evidence.start_line >= MAX_STRUCTURAL_WINDOW_LINES
        || evidence.text.chars().count() > MAX_EXCERPT_CHARS
    {
        return false;
    }
    let Ok(bytes) = reader.read_note(&evidence.path) else {
        return false;
    };
    let Some((meta, start)) = metadata(&bytes) else {
        return false;
    };
    if evidence.start_line <= start || ignored(&meta) || discovery(&meta, policy).is_none() {
        return false;
    }
    let lines: Vec<_> = bytes
        .lines()
        .skip(evidence.start_line - 1)
        .take(evidence.end_line - evidence.start_line + 1)
        .collect();
    lines.len() == evidence.end_line - evidence.start_line + 1 && lines.join("\n") == evidence.text
}

pub(crate) fn validate_expansion_capacity(
    question: &str,
    hints: &[crate::RequirementHints],
) -> Result<(), PublicError> {
    let terms = query_terms(question);
    if terms.len() == MAX_QUERY_TERMS
        && hints
            .iter()
            .flat_map(|h| query_terms(&h.terms.join(" ")))
            .any(|term| !terms.contains(&term))
    {
        return Err(PublicError::ContextOverflow);
    }
    Ok(())
}

fn valid_cached_source(entry: &crate::IndexedSource, source: &str) -> bool {
    use sha2::{Digest, Sha256};
    let body_start = source
        .strip_prefix('\u{feff}')
        .unwrap_or(source)
        .lines()
        .enumerate()
        .skip(1)
        .find(|(_, line)| line.trim_end_matches([' ', '\t']) == "---")
        .map(|(i, _)| i + 1);
    if body_start != Some(entry.body_start) {
        return false;
    }
    if entry.body_start < 2
        || entry.body_start > source.lines().count()
        || entry.blocks.len() > MAX_BLOCKS_PER_NOTE
    {
        return false;
    }
    let starts: Vec<_> = std::iter::once(0)
        .chain(source.match_indices('\n').map(|(i, _)| i + 1))
        .collect();
    entry.blocks.iter().enumerate().all(|(i, b)| {
        let Some(raw) = source.get(b.bytes.clone()) else {
            return false;
        };
        b.start_line > entry.body_start
            && b.end_line >= b.start_line
            && starts.partition_point(|offset| *offset <= b.bytes.start) == b.start_line
            && starts.partition_point(|offset| *offset < b.bytes.end) == b.end_line
            && !raw.is_empty()
            && <[u8; 32]>::from(Sha256::digest(raw.as_bytes())) == b.hash
            && b.headings.len() <= 6
            && b.headings
                .iter()
                .all(|h| *h < i && entry.blocks[*h].kind == crate::BlockKind::Heading)
    })
}

pub(crate) fn requirement_relevance(text: &str, requirements: &[&str]) -> usize {
    let body = lexical_terms(&crate::chat::factual_prose_lines(text, "").join(" "));
    requirements
        .iter()
        .map(|q| {
            query_terms(q)
                .iter()
                .filter(|term| body.contains(term))
                .count()
        })
        .sum()
}

pub(crate) fn request_terms(question: &str) -> Vec<String> {
    query_terms(question)
        .into_iter()
        .filter(|t| {
            ![
                "note",
                "say",
                "about",
                "measured",
                "recorded",
                "reported",
                "measurement",
                "value",
                "result",
                "many",
                "much",
            ]
            .contains(&t.as_str())
        })
        .collect()
}
pub(crate) fn all_request_terms_in(question: &str, clause: &str) -> bool {
    let terms = request_terms(question);
    let words = lexical_terms(clause);
    !terms.is_empty() && terms.iter().all(|term| words.contains(term))
}
pub(crate) fn any_request_term_in(question: &str, clause: &str) -> bool {
    let words = lexical_terms(clause);
    request_terms(question)
        .iter()
        .any(|term| words.contains(term))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_requires_bounded_typed_fields() {
        let policy = AccessPolicy::default();
        for yaml in [
            "description: ok\ntags: [science]\naliases: []",
            "description: ok\ntags: [science]\naliases: [moon]",
        ] {
            let Ok(value) = serde_yaml_ng::from_str(yaml) else {
                panic!("synthetic yaml")
            };
            assert!(discovery(&value, &policy).is_some());
        }
        for yaml in [
            "description: ''\ntags: [science]\naliases: []",
            "description: ok\ntags: []\naliases: []",
            "description: ok\ntags: [42]\naliases: []",
            "description: ok\ntags: [science]\naliases: null",
            "description: ok\ntags: [science]",
        ] {
            let Ok(value) = serde_yaml_ng::from_str(yaml) else {
                panic!("synthetic yaml")
            };
            assert!(discovery(&value, &policy).is_none());
        }
    }
    #[test]
    fn malformed_and_excessively_nested_yaml_fail_closed() {
        assert!(metadata("---\ntags: [\n---\nbody").is_none());
        assert!(metadata("no frontmatter").is_none());
        let nested = format!("---\na: {}0{}\n---\nbody", "[".repeat(150), "]".repeat(150));
        assert!(metadata(&nested).is_none());
    }
}
