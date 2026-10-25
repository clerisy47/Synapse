use rustix::fs::{self, FlockOperation};
use std::{
    os::fd::OwnedFd,
    time::{Duration, Instant},
};
use synapse_core::{Cancellation, PublicError};

pub const LEASE_WAIT: Duration = Duration::from_secs(30);
pub struct ProviderLease(OwnedFd);
impl ProviderLease {
    pub fn acquire(cancel: &Cancellation) -> Result<Self, PublicError> {
        let fd =
            crate::state_store::provider_lease_file().map_err(|_| PublicError::AccessRefused)?;
        let deadline = Instant::now() + LEASE_WAIT;
        loop {
            if cancel.is_cancelled() {
                return Err(PublicError::Cancelled);
            }
            match fs::flock(&fd, FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => return Ok(Self(fd)),
                Err(error)
                    if matches!(
                        error,
                        rustix::io::Errno::WOULDBLOCK | rustix::io::Errno::ACCESS
                    ) && Instant::now() < deadline =>
                {
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
