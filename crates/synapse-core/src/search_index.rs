//! Derived discovery state never authorizes citations.
use crate::{NotePath, PublicError, SourceBlock};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexedSource {
    pub path: NotePath,
    pub hash: [u8; 32],
    pub blocks: Vec<SourceBlock>,
    pub body_start: usize,
    pub discovery: String,
    pub links: Vec<NotePath>,
}
pub struct IndexTerms {
    pub path: NotePath,
    pub blocks: Vec<(usize, String)>,
}
pub struct IndexHit {
    pub path: NotePath,
    pub hash: [u8; 32],
    pub block: usize,
}
pub trait SearchIndexPort: Send + Sync {
    fn load(&self, policy: &str) -> Result<Vec<IndexedSource>, PublicError>;
    fn publish(
        &self,
        policy: &str,
        sources: &[IndexedSource],
        changed: &[IndexTerms],
    ) -> Result<(), PublicError>;
    fn phrase_candidates(
        &self,
        policy: &str,
        terms: &[String],
    ) -> Result<Vec<IndexHit>, PublicError>;
    fn candidates(&self, policy: &str, terms: &[String]) -> Result<Vec<IndexHit>, PublicError>;
}

#[derive(Default)]
struct MemoryState {
    policy: String,
    sources: Vec<IndexedSource>,
    terms: Vec<IndexTerms>,
}
/// Deterministic adapter for synthetic tests; stores derived terms only.
#[derive(Default)]
pub struct MemorySearchIndex(std::sync::Mutex<MemoryState>);
impl SearchIndexPort for MemorySearchIndex {
    fn load(&self, policy: &str) -> Result<Vec<IndexedSource>, PublicError> {
        let mut state = self.0.lock().map_err(|_| PublicError::StateUnavailable)?;
        if state.policy != policy {
            *state = MemoryState {
                policy: policy.into(),
                ..MemoryState::default()
            };
        }
        Ok(state.sources.clone())
    }
    fn publish(
        &self,
        policy: &str,
        sources: &[IndexedSource],
        changed: &[IndexTerms],
    ) -> Result<(), PublicError> {
        let mut state = self.0.lock().map_err(|_| PublicError::StateUnavailable)?;
        if state.policy != policy {
            *state = MemoryState {
                policy: policy.into(),
                ..MemoryState::default()
            };
        }
        state.terms.retain(|t| {
            sources.iter().any(|s| s.path == t.path) && !changed.iter().any(|c| c.path == t.path)
        });
        for item in changed {
            state.terms.push(IndexTerms {
                path: item.path.clone(),
                blocks: item.blocks.clone(),
            });
        }
        state.sources = sources.to_vec();
        Ok(())
    }
    fn phrase_candidates(
        &self,
        policy: &str,
        terms: &[String],
    ) -> Result<Vec<IndexHit>, PublicError> {
        self.query_terms(policy, terms, true)
    }
    fn candidates(&self, policy: &str, terms: &[String]) -> Result<Vec<IndexHit>, PublicError> {
        self.query_terms(policy, terms, false)
    }
}
impl MemorySearchIndex {
    fn query_terms(
        &self,
        policy: &str,
        terms: &[String],
        phrase: bool,
    ) -> Result<Vec<IndexHit>, PublicError> {
        let state = self.0.lock().map_err(|_| PublicError::StateUnavailable)?;
        if state.policy != policy {
            return Err(PublicError::Conflict);
        }
        let mut ranked = Vec::new();
        for entry in &state.terms {
            let source = state
                .sources
                .iter()
                .find(|s| s.path == entry.path)
                .ok_or(PublicError::StateUnavailable)?;
            for (block, tokens) in &entry.blocks {
                let score = terms
                    .iter()
                    .filter(|term| {
                        tokens
                            .split_whitespace()
                            .any(|token| token == term.as_str())
                    })
                    .count();
                let phrase_matches = !phrase
                    || (!terms.is_empty()
                        && tokens
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .windows(terms.len())
                            .any(|window| {
                                window.iter().copied().eq(terms.iter().map(String::as_str))
                            }));
                if score > 0 && phrase_matches {
                    ranked.push((
                        score,
                        IndexHit {
                            path: entry.path.clone(),
                            hash: source.hash,
                            block: *block,
                        },
                    ));
                }
            }
        }
        ranked.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.path.cmp(&b.1.path))
                .then_with(|| a.1.block.cmp(&b.1.block))
        });
        Ok(ranked.into_iter().take(64).map(|(_, hit)| hit).collect())
    }
}
