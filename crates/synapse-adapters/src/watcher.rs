use crate::CanonicalWorkspace;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use synapse_core::{MAX_INDEX_BYTES, NoteReadPort, PublicError};

pub const WATCH_INTERVAL: Duration = Duration::from_millis(250);
/// Polling is a hint only. Evidence and writes must independently recheck bytes.
pub struct PollingWatcher {
    generation: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl PollingWatcher {
    pub fn start(reader: Arc<CanonicalWorkspace>) -> Result<Self, PublicError> {
        let initial = signature(&reader)?;
        let generation = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let thread_generation = generation.clone();
        let thread_stop = stop.clone();
        let worker = thread::Builder::new()
            .name("synapse-workspace-watch".into())
            .spawn(move || {
                let mut last = Ok(initial);
                while !thread_stop.load(Ordering::Acquire) {
                    let current = signature(&reader);
                    if current != last {
                        thread_generation.fetch_add(1, Ordering::AcqRel);
                        last = current;
                    }
                    thread::park_timeout(WATCH_INTERVAL);
                }
            })
            .map_err(|_| PublicError::WorkspaceUnavailable)?;
        Ok(Self {
            generation,
            stop,
            worker: Some(worker),
        })
    }
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }
}
impl Drop for PollingWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            worker.thread().unpark();
            let _ = worker.join();
        }
    }
}
fn signature(reader: &CanonicalWorkspace) -> Result<u64, PublicError> {
    let mut digest = DefaultHasher::new();
    let mut size = 0;
    for path in reader.list_notes()? {
        path.as_str().hash(&mut digest);
        match reader.read_note(&path) {
            Ok(text) => {
                size += text.len();
                if size > MAX_INDEX_BYTES {
                    return Err(PublicError::ResourceLimit);
                }
                text.hash(&mut digest);
            }
            Err(error) => error.code().hash(&mut digest),
        }
    }
    Ok(digest.finish())
}
