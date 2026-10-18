use std::collections::BTreeMap;
use std::sync::Arc;
use synapse_core::{CorpusError, CorpusPolicy, CorpusReadPort, Document, NotePath, Scan};

/// Opaque process-local reference. Only this corpus can mint evidence IDs.
#[derive(Clone, Debug)]
pub struct EvidenceId {
    owner: Arc<()>,
    generation: u64,
    ordinal: usize,
    line: usize,
}
impl PartialEq for EvidenceId {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.owner, &other.owner)
            && self.generation == other.generation
            && self.ordinal == other.ordinal
            && self.line == other.line
    }
}
impl Eq for EvidenceId {}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Passage {
    pub path: NotePath,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}
#[derive(Clone, Debug)]
pub struct Hit {
    pub evidence: EvidenceId,
    pub path: NotePath,
    pub score: usize,
}

pub struct Corpus<R> {
    graph: Vec<Vec<usize>>,
    reader: R,
    policy: CorpusPolicy,
    snapshot: Option<Scan>,
    generation: u64,
    owner: Arc<()>,
}
impl<R: CorpusReadPort> Corpus<R> {
    pub fn new(reader: R, policy: CorpusPolicy) -> Self {
        Self {
            reader,
            graph: Vec::new(),
            policy,
            snapshot: None,
            generation: 0,
            owner: Arc::new(()),
        }
    }
    /// Polling watcher: compare bounded current bytes, not timestamps. On failure
    /// discard every previous passage. Call before every output boundary.
    pub fn refresh(&mut self) -> Result<bool, CorpusError> {
        let scan = match self.reader.scan(&self.policy) {
            Ok(s) => s,
            Err(e) => {
                self.invalidate()?;
                return Err(e);
            }
        };
        if self.snapshot.as_ref() == Some(&scan) {
            return Ok(false);
        }
        self.invalidate()?;
        self.graph = graph(&scan.documents)?;
        self.snapshot = Some(scan);
        Ok(true)
    }
    fn invalidate(&mut self) -> Result<(), CorpusError> {
        self.snapshot = None;
        self.graph.clear();
        self.generation = self.generation.checked_add(1).ok_or(CorpusError::Limit)?;
        Ok(())
    }
    pub fn set_policy(&mut self, policy: CorpusPolicy) -> Result<(), CorpusError> {
        self.invalidate()?;
        self.policy = policy;
        Ok(())
    }
    pub fn attention(&mut self) -> Result<Vec<NotePath>, CorpusError> {
        self.refresh()?;
        Ok(self
            .snapshot
            .as_ref()
            .ok_or(CorpusError::Stale)?
            .attention
            .iter()
            .map(|a| a.path.clone())
            .collect())
    }
    pub fn search(&mut self, query: &str) -> Result<Vec<Hit>, CorpusError> {
        if query.len() > 1024 {
            return Err(CorpusError::Limit);
        }
        self.refresh()?;
        let terms: Vec<_> = query
            .split_whitespace()
            .take(17)
            .map(str::to_lowercase)
            .collect();
        if terms.len() > 16 {
            return Err(CorpusError::Limit);
        }
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let mut hits = Vec::new();
        for (ordinal, doc) in self
            .snapshot
            .as_ref()
            .ok_or(CorpusError::Stale)?
            .documents
            .iter()
            .enumerate()
        {
            let metadata = format!(
                "{} {} {} {}",
                doc.path.as_str(),
                doc.metadata.description,
                doc.metadata.tags.join(" "),
                doc.metadata.aliases.join(" ")
            )
            .to_lowercase();
            let body = doc.body.to_lowercase();
            let score = terms
                .iter()
                .filter(|t| metadata.contains(t.as_str()) || body.contains(t.as_str()))
                .count();
            if score == 0 || doc.body.trim().is_empty() {
                continue;
            }
            let line = doc
                .body
                .lines()
                .position(|s| terms.iter().any(|t| s.to_lowercase().contains(t.as_str())))
                .or_else(|| doc.body.lines().position(|s| !s.trim().is_empty()))
                .unwrap_or(0);
            hits.push(Hit {
                evidence: EvidenceId {
                    owner: self.owner.clone(),
                    generation: self.generation,
                    ordinal,
                    line,
                },
                path: doc.path.clone(),
                score,
            });
        }
        hits.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then(a.path.as_str().cmp(b.path.as_str()))
        });
        hits.truncate(self.policy.limits().results);
        Ok(hits)
    }
    pub fn resolve(&mut self, id: &EvidenceId) -> Result<Passage, CorpusError> {
        self.refresh()?;
        if !Arc::ptr_eq(&id.owner, &self.owner) || id.generation != self.generation {
            return Err(CorpusError::Stale);
        }
        let doc = self
            .snapshot
            .as_ref()
            .and_then(|s| s.documents.get(id.ordinal))
            .ok_or(CorpusError::Stale)?;
        if !self.policy.permits(doc.path.as_str()) || !self.policy.permits_tags(&doc.metadata.tags)
        {
            return Err(CorpusError::Stale);
        }
        let text = doc.body.lines().nth(id.line).ok_or(CorpusError::Stale)?;
        // Preserve exact evidence coordinates. Refuse overlong passages rather than
        // fabricate a truncated quote with a misleading complete-line coordinate.
        if text.len() > 4096 {
            return Err(CorpusError::Limit);
        }
        Ok(Passage {
            path: doc.path.clone(),
            start_line: doc.body_start_line + id.line,
            end_line: doc.body_start_line + id.line,
            text: text.to_owned(),
        })
    }
    /// Mint bounded adjacent body-line IDs from an already trusted hit. No model paths.
    pub fn context(&mut self, id: &EvidenceId) -> Result<Vec<EvidenceId>, CorpusError> {
        self.resolve(id)?;
        let doc = self
            .snapshot
            .as_ref()
            .and_then(|s| s.documents.get(id.ordinal))
            .ok_or(CorpusError::Stale)?;
        let mut ids = vec![id.clone()];
        for line in id.line.saturating_sub(1)..=id.line.saturating_add(2) {
            if line != id.line
                && doc
                    .body
                    .lines()
                    .nth(line)
                    .is_some_and(|s| !s.trim().is_empty())
            {
                let mut adjacent = id.clone();
                adjacent.line = line;
                ids.push(adjacent);
            }
        }
        Ok(ids)
    }
    pub fn first_passage(&mut self, path: &NotePath) -> Result<Option<EvidenceId>, CorpusError> {
        self.refresh()?;
        let scan = self.snapshot.as_ref().ok_or(CorpusError::Stale)?;
        Ok(scan
            .documents
            .iter()
            .enumerate()
            .find(|(_, d)| &d.path == path)
            .and_then(|(ordinal, doc)| {
                doc.body
                    .lines()
                    .position(|s| !s.trim().is_empty())
                    .map(|line| EvidenceId {
                        owner: self.owner.clone(),
                        generation: self.generation,
                        ordinal,
                        line,
                    })
            }))
    }
    /// Resolve local Markdown and wikilinks only against the permitted corpus.
    /// URL and traversing destinations grant nothing. Fragments select a file,
    /// never a trusted passage; evidence still requires a separately minted ID.
    pub fn links(&mut self, path: &NotePath) -> Result<Vec<NotePath>, CorpusError> {
        self.refresh()?;
        let docs = &self.snapshot.as_ref().ok_or(CorpusError::Stale)?.documents;
        let ordinal = docs
            .iter()
            .position(|d| &d.path == path)
            .ok_or(CorpusError::Stale)?;
        Ok(self.graph[ordinal]
            .iter()
            .map(|i| docs[*i].path.clone())
            .take(self.policy.limits().results)
            .collect())
    }
    pub fn backlinks(&mut self, path: &NotePath) -> Result<Vec<NotePath>, CorpusError> {
        self.refresh()?;
        let docs = &self.snapshot.as_ref().ok_or(CorpusError::Stale)?.documents;
        let ordinal = docs
            .iter()
            .position(|d| &d.path == path)
            .ok_or(CorpusError::Stale)?;
        Ok(self
            .graph
            .iter()
            .enumerate()
            .filter(|(_, links)| links.contains(&ordinal))
            .map(|(i, _)| docs[i].path.clone())
            .take(self.policy.limits().results)
            .collect())
    }
}
const MAX_LINKS_PER_NOTE: usize = 256;
const MAX_LINKS: usize = 20_000;
fn graph(docs: &[Document]) -> Result<Vec<Vec<usize>>, CorpusError> {
    let names: BTreeMap<_, _> = docs
        .iter()
        .enumerate()
        .map(|(i, d)| (d.path.as_str(), i))
        .collect();
    let mut graph = Vec::new();
    let mut count = 0;
    for doc in docs {
        let parent = doc.path.as_str().rsplit_once('/').map_or("", |(p, _)| p);
        let mut edges = Vec::new();
        let wiki = doc.body.split("[[").skip(1).filter_map(|s| {
            s.split_once("]]")
                .map(|(s, _)| (s.split('|').next().unwrap_or(""), true))
        });
        let markdown = doc.body.split("](").skip(1).filter_map(|s| {
            s.split_once(')')
                .map(|(s, _)| (s.split_whitespace().next().unwrap_or(""), false))
        });
        for (n, (raw, is_wiki)) in wiki.chain(markdown).enumerate() {
            count += 1;
            if n >= MAX_LINKS_PER_NOTE || count > MAX_LINKS {
                return Err(CorpusError::Limit);
            }
            let raw = raw.strip_prefix("./").unwrap_or(raw);
            let raw = raw.trim_matches(['<', '>']).split('#').next().unwrap_or("");
            let dest = if is_wiki && !raw.ends_with(".md") {
                format!("{raw}.md")
            } else {
                raw.to_owned()
            };
            if NotePath::parse(&dest).is_err() {
                continue;
            }
            let local = if parent.is_empty() {
                dest.clone()
            } else {
                format!("{parent}/{dest}")
            };
            let found = names.get(local.as_str()).or_else(|| {
                if is_wiki {
                    names.get(dest.as_str())
                } else {
                    None
                }
            });
            if let Some(target) = found {
                if !edges.contains(target) {
                    edges.push(*target);
                }
            }
        }
        edges.sort_unstable();
        graph.push(edges);
    }
    Ok(graph)
}
