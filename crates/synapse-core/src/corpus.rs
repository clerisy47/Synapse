use crate::{NotePath, NoteReadPort, PublicError};
use serde_yaml_ng::Value;

pub const MAX_INDEX_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_RESULTS: usize = 8;
pub const MAX_EXCERPT_CHARS: usize = 1200;

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
    pub fn permits_path(&self, path: &NotePath) -> bool {
        path != &self.instructions
            && path != &self.research
            && !path.as_str().split('/').any(|part| part.starts_with('.'))
            && !self.folders.iter().any(|folder| {
                path.as_str() == folder || path.as_str().starts_with(&format!("{folder}/"))
            })
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
    links: Vec<NotePath>,
}
pub struct Corpus {
    notes: Vec<Note>,
    attention: Vec<NotePath>,
    policy: AccessPolicy,
}
impl Corpus {
    pub fn build(reader: &impl NoteReadPort, policy: AccessPolicy) -> Result<Self, PublicError> {
        let mut notes = Vec::new();
        let mut attention = Vec::new();
        let mut bytes_used = 0;
        for path in reader.list_notes()? {
            if !policy.permits_path(&path) {
                continue;
            }
            let bytes = match reader.read_note(&path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    attention.push(path);
                    continue;
                }
            };
            bytes_used += bytes.len();
            if bytes_used > MAX_INDEX_BYTES {
                return Err(PublicError::ResourceLimit);
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
            notes.push(Note {
                modified,
                links,
                path,
                bytes,
                body_start,
                discovery,
            });
        }
        Ok(Self {
            notes,
            attention,
            policy,
        })
    }
    /// Polling invalidation: discard the old generation on each refresh. No stale
    /// evidence is returned between refreshes because query rechecks exact bytes.
    pub fn refresh(
        &mut self,
        reader: &impl NoteReadPort,
        policy: AccessPolicy,
    ) -> Result<(), PublicError> {
        let replacement = Self::build(reader, policy)?;
        *self = replacement;
        Ok(())
    }
    pub fn linked(
        &self,
        path: &NotePath,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<NotePath> {
        if !self
            .notes
            .iter()
            .any(|note| &note.path == path && self.current(note, reader, policy))
        {
            return Vec::new();
        }
        let mut result: Vec<_> = self
            .notes
            .iter()
            .filter(|note| {
                self.current(note, reader, policy)
                    && &note.path != path
                    && (note.links.contains(path)
                        || self.notes.iter().any(|source| {
                            self.current(source, reader, policy)
                                && &source.path == path
                                && source.links.contains(&note.path)
                        }))
            })
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
        if bytes != note.bytes {
            return false;
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
    pub fn note_count(&self) -> usize {
        self.notes.len()
    }
    pub fn query(
        &self,
        question: &str,
        reader: &impl NoteReadPort,
        policy: &AccessPolicy,
    ) -> Vec<Evidence> {
        let terms: Vec<_> = question
            .split_whitespace()
            .take(32)
            .map(str::to_lowercase)
            .collect();
        if question.len() > 4096 || terms.is_empty() {
            return Vec::new();
        }
        let mut candidates = Vec::new();
        for note in &self.notes {
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
            let score = terms
                .iter()
                .filter(|term| {
                    note.bytes.to_lowercase().contains(term.as_str())
                        || note.discovery.to_lowercase().contains(term.as_str())
                        || note.path.as_str().to_lowercase().contains(term.as_str())
                })
                .count();
            if score == 0 {
                continue;
            }
            let lines: Vec<_> = note
                .bytes
                .lines()
                .enumerate()
                .skip(note.body_start)
                .collect();
            let offset = lines
                .iter()
                .position(|(_, line)| {
                    terms
                        .iter()
                        .any(|term| line.to_lowercase().contains(term.as_str()))
                })
                .unwrap_or(0);
            if !lines.is_empty() {
                let selected: Vec<_> = lines.iter().skip(offset).take(6).collect();
                if let (Some(first), Some(last)) = (selected.first(), selected.last()) {
                    let text = selected
                        .iter()
                        .map(|(_, line)| *line)
                        .collect::<Vec<_>>()
                        .join("\n");
                    if text.chars().count() <= MAX_EXCERPT_CHARS {
                        candidates.push((
                            score,
                            Evidence {
                                id: 0,
                                path: note.path.clone(),
                                start_line: first.0 + 1,
                                end_line: last.0 + 1,
                                text,
                            },
                        ));
                    }
                }
            }
        }
        candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.path.cmp(&b.1.path)));
        candidates
            .into_iter()
            .take(MAX_RESULTS)
            .enumerate()
            .map(|(id, (_, mut evidence))| {
                evidence.id = id + 1;
                evidence
            })
            .collect()
    }
}
fn metadata(bytes: &str) -> Option<(Value, usize)> {
    let mut lines = bytes.lines();
    if lines.next()? != "---" {
        return None;
    }
    let mut yaml = String::new();
    let mut count = 1;
    for line in lines {
        count += 1;
        if line == "---" {
            return Some((serde_yaml_ng::from_str(&yaml).ok()?, count));
        }
        yaml.push_str(line);
        yaml.push('\n');
    }
    None
}
fn ignored(value: &Value) -> bool {
    ["synapse", "vault-synapse"].iter().any(|key| {
        value.get(*key).is_some_and(|value| {
            value.as_str() == Some("ignore")
                || value.get("ignore").and_then(Value::as_bool) == Some(true)
        })
    })
}

fn discovery(meta: &Value, policy: &AccessPolicy) -> Option<String> {
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
fn strings(value: &Value, min: usize, max: usize, width: usize) -> Option<Vec<String>> {
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

fn excluded_tags(meta: &Value, policy: &AccessPolicy) -> bool {
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
        || evidence.id > MAX_RESULTS
        || !policy.permits_path(&evidence.path)
        || evidence.start_line == 0
        || evidence.end_line < evidence.start_line
        || evidence.end_line - evidence.start_line >= 6
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
