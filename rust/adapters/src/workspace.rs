use std::fs;
use std::path::Path;
use synapse_core::{PublicError, WorkspaceInfo, WorkspaceReadPort};

pub struct NativeWorkspace;

impl WorkspaceReadPort for NativeWorkspace {
    fn validate_root(&self, selected: &str) -> Result<WorkspaceInfo, PublicError> {
        let root =
            fs::canonicalize(Path::new(selected)).map_err(|_| PublicError::InvalidWorkspace)?;
        if !fs::metadata(&root)
            .map_err(|_| PublicError::InvalidWorkspace)?
            .is_dir()
        {
            return Err(PublicError::InvalidWorkspace);
        }
        Ok(WorkspaceInfo {
            canonical_display: root.to_string_lossy().into_owned(),
        })
    }
}
