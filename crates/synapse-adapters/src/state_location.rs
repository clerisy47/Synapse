use std::path::{Path, PathBuf};
use synapse_core::PublicError;

/// Resolve the future state location without creating or importing any state.
pub fn state_location() -> Result<PathBuf, PublicError> {
    let home = std::env::var_os("HOME").ok_or(PublicError::AccessRefused)?;
    #[cfg(target_os = "macos")]
    let path = PathBuf::from(home).join("Library/Application Support/Synapse");
    #[cfg(target_os = "linux")]
    let path = match std::env::var_os("XDG_STATE_HOME") {
        Some(base) if Path::new(&base).is_absolute() => PathBuf::from(base).join("synapse"),
        Some(_) => return Err(PublicError::AccessRefused),
        None => PathBuf::from(home).join(".local/state/synapse"),
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    return Err(PublicError::AccessRefused);
    resolve_missing(&path)
}
fn resolve_missing(path: &Path) -> Result<PathBuf, PublicError> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(PublicError::AccessRefused),
        Ok(_) => {
            if let Some(parent) = path.parent() {
                if parent != path {
                    let _ = resolve_missing(parent)?;
                }
            }
            path.canonicalize().map_err(|_| PublicError::AccessRefused)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or(PublicError::AccessRefused)?;
            let name = path.file_name().ok_or(PublicError::AccessRefused)?;
            Ok(resolve_missing(parent)?.join(name))
        }
        Err(_) => Err(PublicError::AccessRefused),
    }
}
pub fn reject_overlap(root: &Path, state: &Path) -> Result<(), PublicError> {
    if root.starts_with(state) || state.starts_with(root) {
        Err(PublicError::AccessRefused)
    } else {
        Ok(())
    }
}
