//! Filesystem and OS boundary. No note-write capability exists in the scaffold.
mod workspace;
pub use workspace::CanonicalWorkspace;

mod state_location;
pub use state_location::{reject_overlap, state_location};

mod watcher;
pub use watcher::{PollingWatcher, WATCH_INTERVAL, WorkspaceWatcher};

mod job_queue;
mod provider;
mod provider_lease;
pub use job_queue::JobQueue;
pub use provider::{
    Provider, local_queue, openrouter_queue, workspace_local_queue, workspace_openrouter_queue,
};

pub use provider_lease::ProviderLease;

mod terminal_os;
pub use terminal_os::{install_interrupt, terminal_columns, terminal_input, terminal_rows};

mod state_store;
pub use state_store::DiskStateStore;

mod approved_write;
pub use approved_write::{JournalRecord, LocalApproval, WriteOutcome};

mod mcp_grants;
pub use mcp_grants::ClientGrant;
mod mcp_handler;
mod mcp_listener;
mod mcp_submit;
pub use mcp_listener::McpListener;
mod mcp_strings;
mod strict_json;

mod search_index;
pub use search_index::{SqliteSearchIndex, query_session};
