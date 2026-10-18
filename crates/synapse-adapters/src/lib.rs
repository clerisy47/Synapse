//! Filesystem and OS boundary. No note-write capability exists in the scaffold.
mod workspace;
pub use workspace::CanonicalWorkspace;

mod state_location;
pub use state_location::{reject_overlap, state_location};

mod watcher;
pub use watcher::{PollingWatcher, WATCH_INTERVAL};

mod job_queue;
mod provider;
mod provider_lease;
pub use job_queue::JobQueue;
pub use provider::{
    Provider, local_queue, openrouter_queue, workspace_local_queue, workspace_openrouter_queue,
};

pub use provider_lease::ProviderLease;
