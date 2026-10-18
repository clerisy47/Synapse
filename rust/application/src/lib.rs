use synapse_core::{PublicError, WorkspaceInfo, WorkspaceReadPort};

/// Read-only foundation facade. No note, provider, state or write capabilities exist yet.
pub fn open_workspace(
    reader: &dyn WorkspaceReadPort,
    selected: &str,
) -> Result<WorkspaceInfo, PublicError> {
    if selected.is_empty() {
        return Err(PublicError::Usage);
    }
    reader.validate_root(selected)
}
