pub const HELP: &str = "Synapse — Markdown workspace terminal\n\nUsage: synapse --workspace <directory>\n       synapse ask --workspace <directory> <question> [--json] [--stats]\n       synapse doctor --workspace <directory> [--offline]\n       synapse search --workspace <directory> <terms> [--json]\n       synapse setup --workspace <directory> [--preview]\n       synapse research capture --workspace <directory> --file <inbox.md> [--lines start:end]\n       synapse research apply --workspace <directory> [--capture N] [--date YYYY-MM-DD] [--preview]\n       synapse research review --workspace <directory> [--capture N] [--date YYYY-MM-DD] [--preview]\n       synapse contradictions --workspace <directory> [--json]\n       synapse metadata review --workspace <directory> [--file <note.md>] [--preview]\n       synapse recovery --workspace <directory> [--revert <id>] [--preview]\n       synapse data clear --workspace <directory>\n       synapse mcp grant --workspace <directory> [--query] [--submit]\n       synapse mcp list --workspace <directory>\n       synapse mcp revoke --workspace <directory> --client <id>\n       synapse mcp serve --workspace <directory>\n       synapse --help\n       synapse --version\n\nOptional remote provider: --provider openrouter [--model <author/model>] --remote-consent\nDefault OpenRouter model: deepseek/deepseek-v4.1-flash\nRemote disclosure: permitted passages, questions, instructions, selected research and bounded conversation history may be sent to OpenRouter and its routed provider. --remote-consent explicitly accepts this disclosure. No silent fallback.\n\nWorkspace options: --instructions <relative.md> --research <relative.md> --exclude-folder <relative-folder> --exclude-tag <tag>\nPersistent lexical indexing is enabled by default in private external state. data clear removes index files and sidecars and revokes grants; unresolved recovery records remain.\nLocal note mutations auto-apply; use --preview to dry-run. High contradiction severity still writes and records a flag. MCP stays off until explicit foreground serve and independent local credential provisioning.\n";
pub const ROOT: &str = "Workspace: ";
pub const DOCTOR_READY: &str = "workspace: available\nprovider: ready\nstate: external";
pub const DOCTOR_OFFLINE: &str = "workspace: available\nprovider: skipped\nstate: untouched";
pub const INSUFFICIENT: &str = "Insufficient evidence in this workspace.";
pub const SEARCHING: &str = "Searching permitted workspace evidence…";
pub const SESSION_HELP: &str = "Ask a question. /source N inspects a source; /search terms searches without a model; /reset clears three-turn memory; /help lists commands; /quit exits. Answers show verified workspace passages.";
pub const PROMPT: &str = "synapse> ";
pub const RESET: &str = "Conversation memory cleared.";

pub const EMPTY_BYTES: &str = "(empty bytes)";
pub const TARGET: &str = "Target: ";
pub const CREATE_FOLDER: &str = "Create folder: ";
pub const BEFORE: &str = "Full before bytes (controls and line endings escaped):";
pub const AFTER: &str = "Full after bytes (controls and line endings escaped):";
pub const NO_CHANGES: &str = "No changes to apply.";
pub const PREVIEW_ONLY: &str = "Preview complete. No notes changed.";
pub const NO_SUPPORTED_RESEARCH: &str = "No supported research proposal from capture:";
pub const CAPTURED: &str = "Saved research capture: ";
pub const CONTRADICTION_FLAG: &str = "Contradiction flag:";
pub const CONTRADICTIONS_EMPTY: &str = "No contradiction flags.";

pub const RETENTION: &str = "Auto-apply keeps full before/after note text in private recovery history for up to 30 days (20 records, 4 MB). Unresolved outcomes are preserved by history clearing. External backups are separate.";
pub const APPLIED: &str = "Applied files:";

pub const CLEAR_WARNING: &str = "Clear local captures, contradiction flags, resolved recovery text, research deduplication and persistent index files/sidecars; revoke MCP grants. Unresolved recovery records are preserved. Notes and configuration are preserved. Synced copies and backups require separate deletion. Type Clear to confirm:";
pub const CLEARED: &str = "Local history cleared.";

pub const MCP_GRANT: &str = "Independent MCP scopes: query discloses permitted excerpts; submit appends unverified inbox text. Separate filesystem access cannot be constrained. Type Grant:";
pub const MCP_CLIENT: &str = "Client:";
pub const MCP_SECRET: &str = "Bearer secret (shown once; keep private):";
pub const MCP_REVOKED: &str = "MCP client revoked.";
pub const MCP_LISTENING: &str = "MCP listening:";
pub const METADATA_INELIGIBLE: &str = "No eligible retrieval notes; metadata attention count:";
pub const METADATA_GUIDANCE: &str = "Use synapse metadata review --workspace <directory> [--preview] to auto-fill missing description, tags or aliases. Malformed metadata, invalid values and oversized notes require manual repair. Excluded notes and control files are not retrieval candidates.";
pub const METADATA_MANUAL: &str = "This note needs manual metadata repair: check YAML and existing description, tags and aliases values. Only missing fields can be proposed; oversized notes exceed the repair limit.";

pub const INDEX_DISCLOSURE: &str = "A private persistent lexical index (terms, source hashes and ranges, including SQLite sidecars) is kept outside the workspace. data clear removes it and revokes grants; unresolved recovery records are preserved.";

pub const QUERY_STATS: &str = "Query stats:";
