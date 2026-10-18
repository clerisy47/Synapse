use crate::Cancellation;

pub const CONTEXT_TOKENS: usize = 4096;
pub const OUTPUT_TOKENS: usize = 128;
pub const MAX_RESPONSE_BYTES: usize = 16_384;
const TEMPLATE_RESERVE: usize = 1024;
const MAX_MODEL_BYTES: usize = 128;

/// Fixed codes only. No provider body, prompt, credential or OS error is retained.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModelError {
    Consent,
    Configuration,
    Budget,
    Busy,
    Cancelled,
    Timeout,
    Offline,
    Http,
    Format,
    Lease,
}
impl ModelError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Consent => "REMOTE_CONSENT_REQUIRED",
            Self::Configuration => "MODEL_CONFIGURATION",
            Self::Budget => "MODEL_BUDGET",
            Self::Busy => "MODEL_BUSY",
            Self::Cancelled => "CANCELLED",
            Self::Timeout => "MODEL_TIMEOUT",
            Self::Offline => "MODEL_OFFLINE",
            Self::Http => "MODEL_HTTP",
            Self::Format => "MODEL_FORMAT",
            Self::Lease => "MODEL_LEASE",
        }
    }
}

/// Created only after the calling local UI discloses the remote data categories.
/// This is a session capability, never deserialized or persisted.
pub struct RemoteConsent {
    _private: (),
}
impl RemoteConsent {
    pub fn after_local_disclosure() -> Self {
        Self { _private: () }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Provider {
    model: Option<String>,
}
impl Provider {
    pub fn bonsai() -> Self {
        Self { model: None }
    }
    pub fn remote_model(&self) -> Option<&str> {
        self.model.as_deref()
    }
    pub fn openrouter(model: &str, _consent: &RemoteConsent) -> Result<Self, ModelError> {
        if model.is_empty()
            || model.len() > MAX_MODEL_BYTES
            || !model
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"/-_.:".contains(&c))
        {
            return Err(ModelError::Configuration);
        }
        Ok(Self {
            model: Some(model.to_owned()),
        })
    }
}

/// Health is the first closed structured task. Future tasks add explicit variants
/// with application-owned evidence IDs; arbitrary schemas/tool calls are not accepted.
pub struct ModelRequest {
    provider: Provider,
}
impl ModelRequest {
    pub fn health(provider: Provider) -> Self {
        Self { provider }
    }
    pub fn provider(&self) -> &Provider {
        &self.provider
    }
    pub fn prompt(&self) -> &'static str {
        "Return exactly the JSON object {\"status\":\"ok\"}."
    }
    /// UTF-8 bytes upper-bound byte-level tokenization. Include the serialized schema
    /// and messages plus a fixed template reserve; refuse rather than truncate.
    pub fn check_budget(&self, serialized_bytes: usize) -> Result<(), ModelError> {
        if serialized_bytes
            .saturating_add(TEMPLATE_RESERVE)
            .saturating_add(OUTPUT_TOKENS)
            > CONTEXT_TOKENS
        {
            Err(ModelError::Budget)
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModelResponse {
    Healthy,
}

pub trait ModelTransport: Send + Sync {
    fn complete(
        &self,
        request: &ModelRequest,
        cancel: &Cancellation,
    ) -> Result<ModelResponse, ModelError>;
}
/// Dropping a guard releases the OS lease. Never remove the shared lock file.
pub trait ModelLease: Send {}
pub trait ModelLeasePort: Send + Sync {
    fn acquire(&self, cancel: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn budget_refuses_instead_of_truncating() {
        let request = ModelRequest::health(Provider::bonsai());
        assert_eq!(request.check_budget(2944), Ok(()));
        assert_eq!(request.check_budget(2945), Err(ModelError::Budget));
        assert_eq!(request.check_budget(usize::MAX), Err(ModelError::Budget));
    }
}
