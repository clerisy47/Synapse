use crate::LocalModelLease;
use rustix::fs::{Mode, OFlags, fstat, mkdirat, open, openat};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use synapse_core::{ModelError, ModelLeasePort, StateStore};

/// Provision only the private global application state root, never a note path.
const MAX_STATE_COMPONENTS: usize = 64;
const MAX_STATE_BYTES: usize = 4096;
pub struct NativeStateStore {
    root: PathBuf,
    workspace: PathBuf,
}
impl NativeStateStore {
    pub fn new(workspace: &Path) -> Result<Self, ModelError> {
        let home = env::var_os("HOME").ok_or(ModelError::Configuration)?;
        let home = PathBuf::from(home);
        if !home.is_absolute() {
            return Err(ModelError::Configuration);
        }
        let home = fs::canonicalize(home).map_err(|_| ModelError::Configuration)?;
        #[cfg(target_os = "macos")]
        let root = home.join("Library/Application Support/Synapse");
        #[cfg(not(target_os = "macos"))]
        let root = match env::var_os("XDG_STATE_HOME") {
            Some(value) => {
                let base = PathBuf::from(value);
                if !base.is_absolute() {
                    return Err(ModelError::Configuration);
                }
                base.join("synapse")
            }
            None => home.join(".local/state/synapse"),
        };
        Self::at(root, workspace)
    }
    fn at(root: PathBuf, workspace: &Path) -> Result<Self, ModelError> {
        let workspace = fs::canonicalize(workspace).map_err(|_| ModelError::Lease)?;
        if root.components().count() > MAX_STATE_COMPONENTS
            || root.to_string_lossy().len() > MAX_STATE_BYTES
            || !root.is_absolute()
            || root
                .components()
                .any(|c| !matches!(c, Component::RootDir | Component::Normal(_)))
            || root.starts_with(&workspace)
            || workspace.starts_with(&root)
        {
            return Err(ModelError::Lease);
        }
        Ok(Self { root, workspace })
    }
    pub fn path(&self) -> &Path {
        &self.root
    }
    fn prepare(&self) -> Result<(), ModelError> {
        let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        let mut directory = open("/", flags, Mode::empty()).map_err(|_| ModelError::Lease)?;
        for part in self.root.components() {
            match part {
                Component::RootDir => {}
                Component::Normal(name) => match openat(&directory, name, flags, Mode::empty()) {
                    Ok(child) => directory = child,
                    Err(rustix::io::Errno::NOENT) => {
                        match mkdirat(&directory, name, Mode::RUSR | Mode::WUSR | Mode::XUSR) {
                            Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                            Err(_) => return Err(ModelError::Lease),
                        }
                        directory = openat(&directory, name, flags, Mode::empty())
                            .map_err(|_| ModelError::Lease)?;
                    }
                    Err(_) => return Err(ModelError::Lease),
                },
                _ => return Err(ModelError::Lease),
            }
        }
        let metadata = fstat(&directory).map_err(|_| ModelError::Lease)?;
        if metadata.st_mode & 0o077 != 0 {
            return Err(ModelError::Lease);
        }
        Ok(())
    }
}
impl StateStore for NativeStateStore {
    fn model_lease(&self) -> Result<Box<dyn ModelLeasePort>, ModelError> {
        self.prepare()?;
        Ok(Box::new(LocalModelLease::open(
            &self.root,
            &self.workspace,
        )?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};
    #[test]
    fn private_state_provisioning_refuses_overlap_symlinks_and_broad_permissions() {
        let base = env::temp_dir()
            .canonicalize()
            .unwrap_or_else(|_| panic!("fixture"))
            .join(format!("synapse-state-{}", std::process::id()));
        fs::create_dir(&base).unwrap_or_else(|_| panic!("fixture"));
        let workspace = base.join("workspace");
        fs::create_dir(&workspace).unwrap_or_else(|_| panic!("fixture"));
        assert!(NativeStateStore::at(workspace.join("state"), &workspace).is_err());
        let root = base.join("state/private");
        let state =
            NativeStateStore::at(root.clone(), &workspace).unwrap_or_else(|_| panic!("fixture"));
        assert!(state.model_lease().is_ok());
        assert!(
            workspace
                .read_dir()
                .unwrap_or_else(|_| panic!("fixture"))
                .next()
                .is_none()
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755))
            .unwrap_or_else(|_| panic!("fixture"));
        assert!(state.model_lease().is_err());
        fs::remove_dir(&root).unwrap_or_else(|_| panic!("fixture"));
        symlink(&workspace, &root).unwrap_or_else(|_| panic!("fixture"));
        assert!(state.model_lease().is_err());
        assert!(
            workspace
                .read_dir()
                .unwrap_or_else(|_| panic!("fixture"))
                .next()
                .is_none()
        );
        fs::remove_dir_all(base).unwrap_or_else(|_| panic!("fixture"));
    }
}
