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
    StateUnavailable,
    Conflict,
    ApprovalRequired,
    RecoveryRequired,
    CapacityExceeded,
    InvalidInstructions,
    InvalidMetadata,
    DateRequired,
    AlreadyProcessed,
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
            Self::StateUnavailable => "state_unavailable",
            Self::Conflict => "conflict",
            Self::ApprovalRequired => "approval_required",
            Self::RecoveryRequired => "recovery_required",
            Self::CapacityExceeded => "capacity_exceeded",
            Self::InvalidInstructions => "invalid_instructions",
            Self::InvalidMetadata => "invalid_metadata",
            Self::DateRequired => "date_required",
            Self::AlreadyProcessed => "already_processed",
        }
    }
    pub const fn exit_code(self) -> u8 {
        match self {
            Self::Usage | Self::WorkspaceUnavailable | Self::TtyRequired => 2,
            Self::NotImplemented | Self::ResourceLimit | Self::OutputUnavailable => 1,
            Self::AccessRefused
            | Self::RemoteConsentRequired
            | Self::Conflict
            | Self::ApprovalRequired
            | Self::RecoveryRequired
            | Self::AlreadyProcessed => 3,
            Self::InvalidInstructions | Self::InvalidMetadata | Self::DateRequired => 2,
            Self::StateUnavailable | Self::CapacityExceeded => 1,
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
pub const MAX_FILES: usize = 200_000;
pub const MAX_INDEXED_NOTES: usize = 10_000;
pub const MAX_DEPTH: usize = 32;
/// Reading remains independent of any write capability.
pub trait NoteReadPort: WorkspaceReadPort {
    fn read_note(&self, note: &NotePath) -> Result<String, PublicError>;
    fn list_notes(&self) -> Result<Vec<NotePath>, PublicError>;
    fn modified_note(&self, note: &NotePath) -> Result<u64, PublicError>;
}

impl serde::Serialize for NotePath {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}
impl<'de> serde::Deserialize<'de> for NotePath {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = <String as serde::Deserialize>::deserialize(deserializer)?;
        Self::parse(&value).map_err(|_| serde::de::Error::custom("invalid_note_path"))
    }
}
