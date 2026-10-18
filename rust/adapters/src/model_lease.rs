use rustix::fd::OwnedFd;
use rustix::fs::{AtFlags, FlockOperation, Mode, OFlags, flock, fstat, open, openat, statat};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use synapse_core::{Cancellation, ModelError, ModelLease, ModelLeasePort};

const WAIT_LIMIT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(20);
const LOCK_NAME: &str = "bonsai-127-0-0-1-18080.lock";
/// All workspaces must use the same private global state directory. No note writes.
/// Caller supplies an existing private OS state root outside the canonical workspace.
pub struct LocalModelLease {
    directory: OwnedFd,
    path: PathBuf,
}
impl LocalModelLease {
    pub fn open(state: &Path, workspace: &Path) -> Result<Self, ModelError> {
        let root = fs::canonicalize(workspace).map_err(|_| ModelError::Lease)?;
        let canonical = fs::canonicalize(state).map_err(|_| ModelError::Lease)?;
        if canonical != state || canonical.starts_with(&root) || root.starts_with(&canonical) {
            return Err(ModelError::Lease);
        }
        let meta = rustix::fs::stat(&canonical).map_err(|_| ModelError::Lease)?;
        if meta.st_mode & 0o170000 != 0o040000 || meta.st_mode & 0o077 != 0 {
            return Err(ModelError::Lease);
        }
        let directory = open_directory(&canonical)?;
        let stat = fstat(&directory).map_err(|_| ModelError::Lease)?;
        if stat.st_ino != meta.st_ino || stat.st_dev != meta.st_dev || stat.st_mode & 0o077 != 0 {
            return Err(ModelError::Lease);
        }
        Ok(Self {
            directory,
            path: canonical,
        })
    }
    fn revalidate(&self) -> Result<(), ModelError> {
        let fresh = open_directory(&self.path)?;
        let a = fstat(&fresh).map_err(|_| ModelError::Lease)?;
        let b = fstat(&self.directory).map_err(|_| ModelError::Lease)?;
        if a.st_ino != b.st_ino || a.st_dev != b.st_dev || a.st_mode & 0o077 != 0 {
            return Err(ModelError::Lease);
        }
        Ok(())
    }
}
fn open_directory(path: &Path) -> Result<OwnedFd, ModelError> {
    if !path.is_absolute() {
        return Err(ModelError::Lease);
    }
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut current = open("/", flags, Mode::empty()).map_err(|_| ModelError::Lease)?;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(part) => {
                current =
                    openat(&current, part, flags, Mode::empty()).map_err(|_| ModelError::Lease)?;
            }
            _ => return Err(ModelError::Lease),
        }
    }
    Ok(current)
}
struct Guard {
    _file: OwnedFd,
}
impl ModelLease for Guard {}
impl ModelLeasePort for LocalModelLease {
    fn acquire(&self, cancel: &Cancellation) -> Result<Box<dyn ModelLease>, ModelError> {
        if cancel.is_cancelled() {
            return Err(ModelError::Cancelled);
        }
        self.revalidate()?;
        // Opening separately per acquisition gives independent flock descriptions,
        // so threads/instances in this process cannot accidentally share a lease.
        let file = openat(
            &self.directory,
            LOCK_NAME,
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| ModelError::Lease)?;
        let stat = fstat(&file).map_err(|_| ModelError::Lease)?;
        if stat.st_mode & 0o170000 != 0o100000 || stat.st_nlink != 1 || stat.st_mode & 0o077 != 0 {
            return Err(ModelError::Lease);
        }
        let started = Instant::now();
        loop {
            if cancel.is_cancelled() {
                return Err(ModelError::Cancelled);
            }
            match flock(&file, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => {
                    self.revalidate()?;
                    let current = statat(&self.directory, LOCK_NAME, AtFlags::SYMLINK_NOFOLLOW)
                        .map_err(|_| ModelError::Lease)?;
                    if current.st_ino != stat.st_ino || current.st_dev != stat.st_dev {
                        return Err(ModelError::Lease);
                    }
                    return Ok(Box::new(Guard { _file: file }));
                }
                Err(rustix::io::Errno::WOULDBLOCK) => {}
                Err(_) => return Err(ModelError::Lease),
            }
            if started.elapsed() >= WAIT_LIMIT {
                return Err(ModelError::Timeout);
            }
            thread::sleep(POLL);
        }
    }
}
