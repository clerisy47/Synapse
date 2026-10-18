use crate::NotePath;
use serde_yaml_ng::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CorpusError {
    Access,
    Limit,
    Stale,
    Policy,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Limits {
    pub file_bytes: usize,
    pub total_bytes: usize,
    pub entries: usize,
    pub depth: usize,
    pub results: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            file_bytes: 1_000_000,
            total_bytes: 32_000_000,
            entries: 10_000,
            depth: 32,
            results: 20,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorpusPolicy {
    controls: Vec<NotePath>,
    folders: Vec<String>,
    tags: Vec<String>,
    limits: Limits,
}
impl Default for CorpusPolicy {
    fn default() -> Self {
        Self {
            controls: ["Synapse/Instructions.md", "Research.md"]
                .iter()
                .filter_map(|s| NotePath::parse(s).ok())
                .collect(),
            folders: Vec::new(),
            tags: Vec::new(),
            limits: Limits::default(),
        }
    }
}
impl CorpusPolicy {
    pub fn new(
        controls: Vec<NotePath>,
        folders: Vec<String>,
        tags: Vec<String>,
        limits: Limits,
    ) -> Result<Self, CorpusError> {
        if controls.len() != 2
            || controls[0]
                .as_str()
                .eq_ignore_ascii_case(controls[1].as_str())
            || folders
                .iter()
                .any(|s| NotePath::parse(&format!("{s}/x.md")).is_err())
            || tags.iter().any(|s| s.is_empty() || s.chars().count() > 64)
            || limits.file_bytes == 0
            || limits.total_bytes < limits.file_bytes
            || limits.entries == 0
            || limits.depth == 0
            || limits.depth > 64
            || limits.results == 0
            || limits.file_bytes > 1_000_000
            || limits.total_bytes > 32_000_000
            || limits.entries > 10_000
            || limits.results > 100
        {
            return Err(CorpusError::Policy);
        }
        Ok(Self {
            controls,
            folders,
            tags,
            limits,
        })
    }
    pub fn limits(&self) -> &Limits {
        &self.limits
    }
    pub fn permits(&self, path: &str) -> bool {
        !path.split('/').any(|s| s.starts_with('.'))
            && !self
                .controls
                .iter()
                .any(|p| p.as_str().eq_ignore_ascii_case(path))
            && !self.folders.iter().any(|f| {
                path.eq_ignore_ascii_case(f)
                    || path
                        .to_ascii_lowercase()
                        .starts_with(&format!("{}/", f.to_ascii_lowercase()))
            })
    }
    pub fn permits_tags(&self, tags: &[String]) -> bool {
        !tags.iter().any(|t| self.tags.contains(t))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Metadata {
    pub description: String,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Document {
    pub path: NotePath,
    pub metadata: Metadata,
    pub body: String,
    pub body_start_line: usize,
    pub frontmatter: String,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attention {
    pub path: NotePath,
}
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Scan {
    pub documents: Vec<Document>,
    pub attention: Vec<Attention>,
}

/// Only bounded permitted UTF-8 documents cross the read boundary. A failed scan
/// must not publish a partial corpus. No generic file or directory handle escapes.
pub trait CorpusReadPort {
    fn scan(&self, policy: &CorpusPolicy) -> Result<Scan, CorpusError>;
}

fn strings(value: Option<&Value>, min: usize, max: usize, width: usize) -> Option<Vec<String>> {
    let list = value?.as_sequence()?;
    if !(min..=max).contains(&list.len()) {
        return None;
    }
    list.iter()
        .map(|v| {
            let s = v.as_str()?;
            (!s.trim().is_empty() && s.chars().count() <= width).then(|| s.to_owned())
        })
        .collect()
}

/// Restrict YAML resource amplification before parsing. Unsupported YAML remains
/// in attention, never retrieval. No body is emitted for excluded/invalid notes.
pub fn parse_document(
    path: NotePath,
    text: &str,
    policy: &CorpusPolicy,
) -> Result<Option<Document>, Attention> {
    let invalid = || Attention { path: path.clone() };
    if !policy.permits(path.as_str()) {
        return Ok(None);
    }
    let mut lines = text.split_inclusive('\n');
    if lines.next().map(str::trim_end) != Some("---") {
        return Err(invalid());
    }
    let mut header = String::new();
    let mut start = 2;
    let mut offset = text.find('\n').map_or(text.len(), |n| n + 1);
    let mut closed = false;
    for line in lines {
        offset += line.len();
        if line.trim_end() == "---" {
            closed = true;
            break;
        }
        header.push_str(line);
        start += 1;
        if header.len() > 16_384 {
            return Err(invalid());
        }
    }
    if !closed || unsafe_yaml(&header) {
        return Err(invalid());
    }
    let yaml: Value = serde_yaml_ng::from_str(&header).map_err(|_| invalid())?;
    let map = yaml.as_mapping().ok_or_else(invalid)?;
    let field = |name: &str| map.get(Value::String(name.to_owned()));
    // Both spellings are exclusions. Malformed metadata also cannot disclose content.
    if field("vault-synapse").and_then(Value::as_str) == Some("ignore")
        || field("synapse").and_then(Value::as_str) == Some("ignore")
    {
        return Ok(None);
    }
    let tags = strings(field("tags"), 1, 12, 64).ok_or_else(invalid)?;
    if !policy.permits_tags(&tags) {
        return Ok(None);
    }
    let description = field("description")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.chars().count() <= 240)
        .ok_or_else(invalid)?
        .to_owned();
    let aliases = strings(field("aliases"), 0, 12, 80).ok_or_else(invalid)?;
    Ok(Some(Document {
        path,
        metadata: Metadata {
            description,
            tags,
            aliases,
        },
        body: text[offset..].to_owned(),
        body_start_line: start + 1,
        frontmatter: text[..offset].to_owned(),
    }))
}

/// Reject YAML references and custom tags before Value allocation. Quoted text
/// remains ordinary data. Conservative false refusals go to the attention view.
fn unsafe_yaml(header: &str) -> bool {
    let mut quote = None;
    let mut escaped = false;
    let mut previous = ' ';
    let mut scalar_start = true;
    let mut chars = header.chars().peekable();
    while let Some(c) = chars.next() {
        // Multiline quoted metadata can conservatively need manual repair;
        // never let a plain scalar's apostrophe hide later YAML references.
        if c == '\n' || c == '\r' {
            quote = None;
            escaped = false;
            scalar_start = true;
            previous = ' ';
            continue;
        }
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if c == '\\' && q == '"' {
                escaped = true;
            } else if c == q {
                if q == '\'' && chars.peek() == Some(&'\'') {
                    chars.next();
                } else {
                    quote = None;
                }
            }
        } else {
            let boundary = previous.is_whitespace() || "[{,:?-".contains(previous);
            if boundary && matches!(c, '&' | '*' | '!') {
                return true;
            }
            if scalar_start && matches!(c, '\'' | '"') {
                quote = Some(c);
            }
            if !c.is_whitespace() {
                scalar_start = false;
            }
            if "[{,}".contains(c) || (c == ':' && chars.peek().is_some_and(|n| n.is_whitespace())) {
                scalar_start = true;
            }
        }
        previous = c;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(header: &str) -> Result<Option<Document>, Attention> {
        parse_document(
            NotePath::parse("A.md").unwrap_or_else(|_| panic!("fixture")),
            &format!("---\n{header}\n---\nbody"),
            &CorpusPolicy::default(),
        )
    }
    #[test]
    fn validates_metadata_without_substituting_it_for_body_evidence() {
        let doc = parse("description: '研究 & * !'\ntags:\n  - public\naliases: []")
            .unwrap_or_else(|_| panic!("metadata"))
            .unwrap_or_else(|| panic!("document"));
        assert_eq!(doc.body, "body");
        assert_eq!(doc.body_start_line, 7);
        for header in [
            "description: ok\ntags: []\naliases: []",
            "description: ''\ntags: [public]\naliases: []",
            "description: ok\ntags: [true]\naliases: []",
            "description: ok\ntags: [public]",
            "description: ok\ntags: [public]\naliases: [null]",
            "description: ok\ndescription: duplicate\ntags: [public]\naliases: []",
            "description: &alias ok\ntags: [public]\naliases: [*alias]",
            "description: ok\ntags: [public]\naliases: [!!str a]",
        ] {
            assert!(parse(header).is_err(), "{header}");
        }
        assert!(
            parse(&format!(
                "description: {}\ntags: [public]\naliases: []",
                "字".repeat(241)
            ))
            .is_err()
        );
        assert!(
            parse(&format!(
                "description: ok\ntags: [{}]\naliases: []",
                "x".repeat(65)
            ))
            .is_err()
        );
        assert!(
            parse(&format!(
                "description: ok\ntags: [public]\naliases: [{}]",
                "x,".repeat(13)
            ))
            .is_err()
        );
        assert!(
            parse(&format!(
                "description: {}\ntags: [public]\naliases: []",
                "x".repeat(17_000)
            ))
            .is_err()
        );
        assert!(
            parse(&format!(
                "description: {}a{}\ntags: [public]\naliases: []",
                "[".repeat(256),
                "]".repeat(256)
            ))
            .is_err()
        );
    }
    #[test]
    fn rejects_yaml_amplification_in_flow_collections() {
        for header in [
            "x: [&a value]\ny: [*a,*a]",
            "x: {a: &a value, b: *a}",
            "x: !!str value",
        ] {
            assert!(unsafe_yaml(header));
        }
        assert!(unsafe_yaml(
            "description: plain 'apostrophe\nx: &a value\ny: [*a,*a]"
        ));
        assert!(!unsafe_yaml(
            "description: 'R&D *values* !'\ntags: [public]"
        ));
    }
    #[test]
    fn policy_requires_distinct_controls_and_bounded_settings() {
        let a = NotePath::parse("A.md").unwrap_or_else(|_| panic!("fixture"));
        assert!(CorpusPolicy::new(vec![a.clone(), a], vec![], vec![], Limits::default()).is_err());
        assert!(
            CorpusPolicy::new(
                vec![],
                vec![],
                vec![],
                Limits {
                    file_bytes: usize::MAX,
                    ..Limits::default()
                }
            )
            .is_err()
        );
    }
}
