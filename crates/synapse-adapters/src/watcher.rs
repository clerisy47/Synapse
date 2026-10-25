use crate::CanonicalWorkspace;
use notify::{RecursiveMode, Watcher};
use std::{
    os::fd::AsRawFd,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use synapse_core::PublicError;
pub const WATCH_INTERVAL: Duration = Duration::from_millis(250);
const MAX_DIRTY_EVENTS: usize = 64;
const MAX_NOTE_HINT_HANDLES: usize = 64;
/// Filesystem events only mark dirty. Pre-query contained hash reconciliation
/// is authoritative even if every notification was missed.
pub struct WorkspaceWatcher {
    generation: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    _watcher: notify::RecommendedWatcher,
    _handles: Vec<std::fs::File>,
}
impl WorkspaceWatcher {
    pub fn start(reader: Arc<CanonicalWorkspace>) -> Result<Self, PublicError> {
        let generation = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (sender, receiver) = mpsc::sync_channel(MAX_DIRTY_EVENTS);
        let overflow = generation.clone();
        let mut watcher = notify::RecommendedWatcher::new(
            move |event: Result<notify::Event, notify::Error>| match sender.try_send(event.is_ok())
            {
                Ok(()) => (),
                Err(mpsc::TrySendError::Full(_)) => {
                    overflow.fetch_add(1, Ordering::AcqRel);
                }
                Err(mpsc::TrySendError::Disconnected(_)) => (),
            },
            notify::Config::default().with_follow_symlinks(false),
        )
        .map_err(|_| PublicError::WorkspaceUnavailable)?;
        let handles = reader.watch_handles(MAX_NOTE_HINT_HANDLES)?;
        for handle in &handles {
            // notify must open the already-contained object, never resolve a
            // descendant pathname that another process can replace by a link.
            #[cfg(target_os = "linux")]
            let path = std::path::PathBuf::from(format!("/proc/self/fd/{}", handle.as_raw_fd()));
            #[cfg(not(target_os = "linux"))]
            let path = std::path::PathBuf::from(format!("/dev/fd/{}", handle.as_raw_fd()));
            watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .map_err(|_| PublicError::WorkspaceUnavailable)?;
        }
        let changed = generation.clone();
        let shutdown = stop.clone();
        let worker = thread::Builder::new()
            .name("synapse-dirty-hints".into())
            .spawn(move || {
                while !shutdown.load(Ordering::Acquire) {
                    match receiver.recv_timeout(Duration::from_millis(25)) {
                        Ok(_) => {
                            changed.fetch_add(1, Ordering::AcqRel);
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => (),
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .map_err(|_| PublicError::WorkspaceUnavailable)?;
        Ok(Self {
            generation,
            stop,
            worker: Some(worker),
            _watcher: watcher,
            _handles: handles,
        })
    }
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }
}
impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
/// Compatibility name for callers; implementation uses notify, never polling.
pub type PollingWatcher = WorkspaceWatcher;
