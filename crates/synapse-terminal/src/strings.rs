pub const HELP: &str = "Synapse — Markdown workspace terminal\n\nUsage: synapse --workspace <directory>\n       synapse ask --workspace <directory> <question> [--json]\n       synapse doctor --workspace <directory> [--offline]\n       synapse search --workspace <directory> <terms> [--json]\n       synapse setup --workspace <directory> [--preview]\n       synapse research capture --workspace <directory> --file <inbox.md> [--lines start:end]\n       synapse research review --workspace <directory> [--capture N] [--date YYYY-MM-DD] [--preview]\n       synapse metadata review --workspace <directory> [--file <note.md>] [--preview]\n       synapse recovery --workspace <directory> [--revert <id>] [--preview]\n       synapse data clear --workspace <directory>\n       synapse mcp grant --workspace <directory> [--query] [--submit]\n       synapse mcp list --workspace <directory>\n       synapse mcp revoke --workspace <directory> --client <id>\n       synapse mcp serve --workspace <directory>\n       synapse --help\n       synapse --version\n\nOptional remote provider: --provider openrouter --model <author/model> --remote-consent\nRemote disclosure: permitted passages, questions, instructions, selected research and bounded conversation history may be sent to OpenRouter and its routed provider. --remote-consent explicitly accepts this disclosure. No silent fallback.\n\nWorkspace options: --instructions <relative.md> --research <relative.md> --exclude-folder <relative-folder> --exclude-tag <tag>\nReview and Apply require a local TTY. MCP stays off until explicit foreground serve and independent local credential provisioning.\n";
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
pub const NEXT_PAGE: &str = "next / skip> ";
pub const ACCEPT_FILE: &str = "accept / skip> ";
pub const NO_CHANGES: &str = "No changes to review.";
pub const PREVIEW_ONLY: &str = "Preview complete. No notes changed.";
pub const SELECT_NOTE: &str = "Select a note number for missing-field proposals: ";
pub const SELECT_CAPTURE: &str = "Select a saved research capture number: ";
pub const SELECT_DATE: &str = "Daily routing requires an explicit date (YYYY-MM-DD): ";
pub const NO_SUPPORTED_RESEARCH: &str = "No supported research proposal from this selection.";
pub const CAPTURED: &str = "Saved research capture: ";

pub const RETENTION: &str = "Apply keeps full before/after note text in private recovery history for up to 30 days (20 records, 4 MB). Unknown outcomes remain until cleared. External backups are separate.";
pub const APPLY_PROMPT: &str = "Apply / cancel> ";
pub const APPLIED: &str = "Applied files:";

pub const CLEAR_WARNING: &str = "Clear local captures, recovery text and research deduplication; revoke pending approvals and MCP grants. Notes and configuration are preserved. Synced copies and backups require separate deletion. Type Clear to confirm:";
pub const CLEARED: &str = "Local history cleared.";

pub const MCP_GRANT: &str = "Independent MCP scopes: query discloses permitted excerpts; submit appends unverified inbox text. Separate filesystem access cannot be constrained. Type Grant:";
pub const MCP_CLIENT: &str = "Client:";
pub const MCP_SECRET: &str = "Bearer secret (shown once; keep private):";
pub const MCP_REVOKED: &str = "MCP client revoked.";
pub const MCP_LISTENING: &str = "MCP listening:";
