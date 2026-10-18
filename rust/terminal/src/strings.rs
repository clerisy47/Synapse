pub const HELP: &str = "Synapse — native Markdown workspace assistant (foundation)

Usage:
  synapse --help
  synapse --version
  synapse --workspace <directory>

An explicit workspace and a terminal are required for interactive use.
Chat, research, providers, state persistence and MCP are not implemented.
";
pub const VERSION: &str = concat!("synapse ", env!("CARGO_PKG_VERSION"));
pub const ROOT_LABEL: &str = "Workspace: ";
pub const FOUNDATION_NOTICE: &str = "Foundation ready; interactive chat is not implemented.";
