mod workspace;

pub use workspace::NativeWorkspace;

#[cfg(unix)]
mod corpus;
#[cfg(unix)]
pub use corpus::WorkspaceCorpus;
