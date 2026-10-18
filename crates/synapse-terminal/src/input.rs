use synapse_core::{Cancellation, PublicError};
const MAX_INPUT_BYTES: usize = 1024;
pub struct Input;
impl Input {
    pub fn start() -> Result<Self, PublicError> {
        Ok(Self)
    }
    pub fn read(&self, cancel: &Cancellation) -> Result<Option<String>, PublicError> {
        let Some(bytes) = synapse_adapters::terminal_input(cancel)? else {
            return Ok(None);
        };
        let line = String::from_utf8(bytes).map_err(|_| PublicError::Usage)?;
        let line = line.trim_end_matches(['\n', '\r']);
        if line.len() > MAX_INPUT_BYTES {
            return Err(PublicError::ResourceLimit);
        }
        Ok(Some(line.to_owned()))
    }
}
