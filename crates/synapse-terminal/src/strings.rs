pub const HELP: &str = "Synapse — Markdown workspace terminal\n\nUsage: synapse --workspace <directory>\n       synapse doctor --workspace <directory> [--offline]\n       synapse --help\n       synapse --version\n\nDevelopment scaffold: chat, model access and writes are not implemented.\n";
pub const ROOT: &str = "Workspace: ";

pub const DOCTOR_READY: &str = "workspace: available\nprovider: ready\nstate: external";
pub const DOCTOR_OFFLINE: &str = "workspace: available\nprovider: skipped\nstate: not initialized";
