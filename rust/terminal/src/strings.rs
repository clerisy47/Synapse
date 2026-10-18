pub const HELP: &str = "Synapse — native Markdown workspace assistant

Usage:
  synapse --help
  synapse --version
  synapse --workspace <directory>
  synapse ask --workspace <directory> <question> [--json]

Options:
  --exclude-folder <relative-folder>  Exclude a workspace folder (repeatable)
  --exclude-tag <tag>                 Exclude a tag (repeatable)
  --instructions <relative.md>        Protected instructions path
  --research <relative.md>            Protected research inbox path
  --provider bonsai|openrouter        Bonsai is the default
  --model <model-id>                  Required for explicitly selected OpenRouter

OpenRouter requires a local terminal disclosure/consent and OPENROUTER_API_KEY.
Interactive commands: /search <terms>, /source <number>, /help, /quit.
Retrieval requires valid description, tags and aliases frontmatter.
Answers show exact verified passages; unsupported questions return insufficient evidence.
Research, approved writes, recovery and MCP are not implemented.
";
pub const VERSION: &str = concat!("synapse ", env!("CARGO_PKG_VERSION"));
pub const ROOT_LABEL: &str = "Workspace: ";
pub const SESSION_HELP: &str =
    "Ask a question, /search <terms> offline, /source <number>, /help, or /quit.";
pub const PROMPT: &str = "synapse> ";
pub const SEARCHING: &str = "Retrieving permitted evidence...";
pub const EVIDENCE: &str = "Verified passages (exact extracts):";
pub const INSUFFICIENT: &str = "Insufficient evidence within the permitted retrieval limits.";
pub const REMOTE_DISCLOSURE: &str = "OpenRouter and its routed provider will receive your question, permitted passages, instructions, selected research and bounded conversation history when used. No automatic fallback. This session does not persist consent. Type send to consent, or anything else to refuse:";
