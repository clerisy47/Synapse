use crate::state_location;
use rustix::fs::{self, FileType, FlockOperation, Mode, OFlags};
use std::{
    os::fd::OwnedFd,
    path::Component,
    time::{Duration, Instant},
};
use synapse_core::{Cancellation, PublicError};

pub const LEASE_WAIT: Duration = Duration::from_secs(30);
pub struct ProviderLease(OwnedFd);
impl ProviderLease {
    pub fn acquire(cancel: &Cancellation) -> Result<Self, PublicError> {
        let path = state_location()?;
        let mut dir = fs::open(
            "/",
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| PublicError::AccessRefused)?;
        for component in path.components() {
            match component {
                Component::RootDir => (),
                Component::Normal(name) => {
                    match fs::mkdirat(&dir, name, Mode::from_raw_mode(0o700)) {
                        Ok(()) => (),
                        Err(rustix::io::Errno::EXIST) => (),
                        Err(_) => return Err(PublicError::AccessRefused),
                    }
                    dir = fs::openat(
                        &dir,
                        name,
                        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                        Mode::empty(),
                    )
                    .map_err(|_| PublicError::AccessRefused)?;
                }
                _ => return Err(PublicError::AccessRefused),
            }
        }
        let metadata = fs::fstat(&dir).map_err(|_| PublicError::AccessRefused)?;
        let owner = rustix::process::getuid().as_raw();
        if metadata.st_uid != owner || metadata.st_mode & 0o077 != 0 {
            return Err(PublicError::AccessRefused);
        }
        // Global runtime lease, shared across workspace processes using this server.
        // Never unlink this file; unlinking would split the lock domain.
        let fd = fs::openat(
            &dir,
            "bonsai-18080.lock",
            OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::from_raw_mode(0o600),
        )
        .map_err(|_| PublicError::AccessRefused)?;
        let stat = fs::fstat(&fd).map_err(|_| PublicError::AccessRefused)?;
        if FileType::from_raw_mode(stat.st_mode) != FileType::RegularFile
            || stat.st_nlink != 1
            || stat.st_uid != owner
            || stat.st_mode & 0o077 != 0
        {
            return Err(PublicError::AccessRefused);
        }
        let deadline = Instant::now() + LEASE_WAIT;
        loop {
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            match fs::flock(&fd, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => return Ok(Self(fd)),
                Err(rustix::io::Errno::WOULDBLOCK) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(_) => return Err(PublicError::ProviderUnavailable),
            }
        }
    }
}
impl Drop for ProviderLease {
    fn drop(&mut self) {
        let _ = fs::flock(&self.0, FlockOperation::Unlock);
    }
}
