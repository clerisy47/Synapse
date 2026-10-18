/// Fixed public diagnostics. Internal OS errors never cross this boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicError {
    Usage,
    InvalidWorkspace,
    InteractiveRequired,
    NotImplemented,
    Output,
    Interrupted,
    Runtime,
}

impl PublicError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Usage => "USAGE",
            Self::InvalidWorkspace => "INVALID_WORKSPACE",
            Self::InteractiveRequired => "INTERACTIVE_REQUIRED",
            Self::NotImplemented => "NOT_IMPLEMENTED",
            Self::Output => "OUTPUT_FAILED",
            Self::Interrupted => "CANCELLED",
            Self::Runtime => "RUNTIME_FAILED",
        }
    }

    pub const fn exit_code(self) -> u8 {
        match self {
            Self::Usage | Self::InvalidWorkspace => 2,
            Self::InteractiveRequired => 3,
            Self::NotImplemented | Self::Output | Self::Runtime => 1,
            Self::Interrupted => 130,
        }
    }
}

/// Intentional local display only; never include this value in diagnostics.
pub struct WorkspaceInfo {
    pub canonical_display: String,
}

/// Foundation capability: validate an explicit root, without traversing notes.
/// Descendant reads and identity checks are added only after RUST-T02 containment tests.
pub trait WorkspaceReadPort {
    fn validate_root(&self, selected: &str) -> Result<WorkspaceInfo, PublicError>;
}
