use crate::{NotePath, PublicError};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};

pub const MAX_CAPTURES: usize = 20;
pub const MAX_CAPTURE_BYTES: usize = 4096;
pub const MAX_CONTROL_BYTES: usize = 128 * 1024;
pub const MAX_INSTRUCTION_BYTES: usize = 16 * 1024;
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContentHash(String);
impl ContentHash {
    pub fn of(bytes: &[u8]) -> Self {
        Self(hex_encode(&Sha256::digest(bytes)))
    }
    pub fn combined(parts: &[&[u8]]) -> Self {
        let mut hash = Sha256::new();
        for part in parts {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part);
        }
        Self(hex_encode(&hash.finalize()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl Serialize for ContentHash {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}
impl<'de> Deserialize<'de> for ContentHash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(serde::de::Error::custom("invalid_hash"));
        }
        Ok(Self(value))
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapturedResearch {
    pub id: ContentHash,
    pub source: NotePath,
    pub source_hash: ContentHash,
    pub selection_hash: ContentHash,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
    pub captured_at: u64,
}
impl CapturedResearch {
    pub fn expected_id(&self, workspace: &ContentHash) -> ContentHash {
        ContentHash::combined(&[
            workspace.as_str().as_bytes(),
            self.source.as_str().as_bytes(),
            self.source_hash.as_str().as_bytes(),
            &(self.start_line as u64).to_le_bytes(),
            &(self.end_line as u64).to_le_bytes(),
            self.selection_hash.as_str().as_bytes(),
        ])
    }
    pub fn validate(&self) -> Result<(), PublicError> {
        if self.text.trim().is_empty()
            || self.text.len() > MAX_CAPTURE_BYTES
            || self.start_line == 0
            || self.end_line < self.start_line
            || self.end_line - self.start_line > MAX_CONTROL_BYTES
            || self.selection_hash != ContentHash::of(self.text.as_bytes())
        {
            return Err(PublicError::StateUnavailable);
        }
        Ok(())
    }
}
/// Capture persistence confers no note-writing or approval authority.
pub trait StateStore: Send + Sync {
    fn workspace_id(&self) -> &ContentHash;
    fn captures(&self) -> Result<Vec<CapturedResearch>, PublicError>;
    fn save_capture(&self, capture: CapturedResearch) -> Result<ContentHash, PublicError>;
    fn contradictions(&self) -> Result<Vec<crate::ContradictionReport>, PublicError> {
        Ok(Vec::new())
    }
    fn save_contradiction(&self, report: crate::ContradictionReport) -> Result<(), PublicError> {
        let _ = report;
        Err(PublicError::NotImplemented)
    }
}
pub trait ControlReadPort {
    fn instructions(&self) -> Result<Option<String>, PublicError>;
    fn inbox(&self) -> Result<Option<String>, PublicError>;
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len().saturating_mul(2));
    for byte in bytes {
        result.push(char::from(DIGITS[usize::from(byte >> 4)]));
        result.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    result
}
