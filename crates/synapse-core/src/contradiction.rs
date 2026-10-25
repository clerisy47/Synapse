use crate::ContentHash;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContradictionSeverity {
    None,
    Low,
    High,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContradictionAssessment {
    pub severity: ContradictionSeverity,
    pub summary: String,
    pub destinations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContradictionReport {
    pub id: ContentHash,
    pub capture: ContentHash,
    pub severity: ContradictionSeverity,
    pub summary: String,
    pub destinations: Vec<String>,
    pub created: u64,
}

pub const MAX_CONTRADICTION_REPORTS: usize = 50;
pub const MAX_CONTRADICTION_SUMMARY: usize = 240;
