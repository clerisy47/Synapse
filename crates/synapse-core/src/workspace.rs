/// Content-free errors suitable for diagnostic output.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicError {
    Usage,
    WorkspaceUnavailable,
    TtyRequired,
    NotImplemented,
    AccessRefused,
    ResourceLimit,
    OutputUnavailable,
    Cancelled,
    ProviderUnavailable,
    InvalidModelOutput,
    RemoteConsentRequired,
    QueueFull,
    ContextOverflow,
    TemplateUnavailable,
    TokenizerUnavailable,
    CompletionUnavailable,
}
impl PublicError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Usage => "usage",
            Self::WorkspaceUnavailable => "workspace_unavailable",
            Self::TtyRequired => "tty_required",
            Self::NotImplemented => "not_implemented",
            Self::AccessRefused => "access_refused",
            Self::ResourceLimit => "resource_limit",
            Self::OutputUnavailable => "output_unavailable",
            Self::Cancelled => "cancelled",
            Self::ProviderUnavailable => "provider_unavailable",
            Self::InvalidModelOutput => "invalid_model_output",
            Self::RemoteConsentRequired => "remote_consent_required",
            Self::QueueFull => "queue_full",
            Self::ContextOverflow => "context_overflow",
            Self::TemplateUnavailable => "provider_template_unavailable",
            Self::TokenizerUnavailable => "provider_tokenizer_unavailable",
            Self::CompletionUnavailable => "provider_completion_unavailable",
        }
    }
    pub const fn exit_code(self) -> u8 {
        match self {
            Self::Usage | Self::WorkspaceUnavailable | Self::TtyRequired => 2,
            Self::NotImplemented | Self::ResourceLimit | Self::OutputUnavailable => 1,
            Self::AccessRefused | Self::RemoteConsentRequired => 3,
            Self::Cancelled => 130,
            Self::ProviderUnavailable
            | Self::InvalidModelOutput
            | Self::QueueFull
            | Self::ContextOverflow
            | Self::TemplateUnavailable
            | Self::TokenizerUnavailable
            | Self::CompletionUnavailable => 1,
        }
    }
}
/// Canonical root for intentional local display, never diagnostic formatting.
pub struct WorkspaceIdentity(String);
impl WorkspaceIdentity {
    pub fn from_canonical_display(value: String) -> Self {
        Self(value)
    }
    pub fn display(&self) -> &str {
        &self.0
    }
}
/// Root validation does not confer descendant read or mutation authority.
pub trait Clock {
    fn monotonic_millis(&self) -> u64;
    fn unix_seconds(&self) -> Result<u64, PublicError>;
}
pub trait WorkspaceReadPort: Clock {
    fn identity(&self) -> &WorkspaceIdentity;
}

/// Validated portable note identifier, never an ambient filesystem path.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct NotePath(String);
impl NotePath {
    pub fn parse(value: &str) -> Result<Self, PublicError> {
        if value.len() > 1024
            || value.split('/').count() > MAX_DEPTH + 1
            || !value.ends_with(".md")
            || value.contains(['\\', ':'])
            || value.chars().any(char::is_control)
            || value
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err(PublicError::AccessRefused);
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
pub const MAX_NOTE_BYTES: u64 = 128 * 1024;
pub const MAX_FILES: usize = 10_000;
pub const MAX_DEPTH: usize = 32;
/// Reading remains independent of any write capability.
pub trait NoteReadPort: WorkspaceReadPort {
    fn read_note(&self, note: &NotePath) -> Result<String, PublicError>;
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError>;
    fn modified_note(&self, note: &NotePath) -> Result<u64, PublicError>;
}
