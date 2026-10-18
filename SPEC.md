# Synapse product specification

Revision: 2026-10-18 · Rust terminal platform baseline · Native read-only chat/ask implemented; reviewed research/writes and MCP pending.

This specification supersedes all previous application-host and TypeScript CLI implementation requirements and task plans. The implementation language is Rust; ship a native `synapse` executable built with Cargo, with no Node.js, JavaScript, TypeScript or Koffi runtime requirement. The subsequent `$deliver` request authorizes the native foundation; feature implementation follows PLAN. Synapse is a standalone terminal application for Markdown knowledge work, inspired by the interaction model of Codex CLI. It does not require a note editor, editor extension, browser, or GUI host. “Codex CLI-style” describes the interface; it does not authorize a coding shell, arbitrary commands, or new inference providers.

## 1. Goal and scope

Help users explore a Markdown workspace, ask questions grounded in its contents, and transform research into locally reviewed note updates. Preserve ordinary Markdown files and existing folder layouts. A workspace is one explicit filesystem root; inferred parent directories and other workspaces are outside scope.

Required first-release capabilities:

- Interactive terminal conversation with bounded multi-step retrieval, progress, cancellation, and source inspection.
- Noninteractive read-only questions with machine-readable output and stable exit behavior.
- Markdown discovery through titles, text, aliases, tags, frontmatter, links/backlinks, and recent files; no embeddings.
- Verified source passages with workspace-relative file paths and line ranges for local users. Unsupported claims produce an explicit insufficient-evidence result.
- Editable workspace instructions and a research inbox, capture with provenance, bounded proposals, exact diff review, explicit Apply, conflict detection, recovery, and reviewed revert.
- Local Bonsai inference, optional explicitly selected OpenRouter, structured model responses, one model queue, health checks, and bounded resources.
- Opt-in authenticated local MCP collaboration with independent query and research-submission scopes.
- Workspace exclusions, protected control files, local state management, privacy checks, tested terminal lifecycle, and standalone packaging.

Out of scope: arbitrary shell execution; autonomous edits; note deletion/rename; runtime/model installation; PDFs/page citations; contradiction detection; daily resurfacing; embeddings/vector databases; telemetry; editor UI or extension distribution. Daily-log routing from reviewed research remains in scope.

## 2. Terminal experience

Proposed executable: `synapse`. This interface is a target, not an availability claim.

| Invocation | Intended behavior |
|---|---|
| `synapse --workspace <directory>` | Open interactive chat and local review actions |
| `synapse ask --workspace <directory> <question> [--json]` | One read-only answer with verified sources |
| `synapse research capture --workspace <directory> --file <workspace-relative.md>` | Capture an explicit saved inbox selection/range without consuming it |
| `synapse research review --workspace <directory>` | Select captured research, generate proposals, review and apply locally |
| `synapse metadata review --workspace <directory>` | Inspect metadata issues and review proposed missing fields |
| `synapse setup --workspace <directory>` | Review creation of missing starter control files |
| `synapse doctor --workspace <directory>` | Diagnose configuration, access, and provider health without exposing content or secrets |
| `synapse recovery --workspace <directory>` | Inspect uncertain writes and review revert proposals |
| `synapse data clear --workspace <directory>` | Explain and confirm deletion of local history while preserving notes/configuration |
| `synapse mcp serve --workspace <directory>` | Start an explicitly enabled local collaboration listener |

Workspace is mandatory; no implicit scan of the home directory. Resolve and display the canonical root before first interactive access. Interactive mode requires a TTY. Redirected input never counts as write approval. Noninteractive modes cannot approve/apply or provision MCP credentials. JSON mode emits one versioned result on stdout; progress and sanitized diagnostics go to stderr. Proposed exit codes: 0 completed (including an explicit insufficient-evidence answer), 1 runtime failure, 2 usage/configuration failure, 3 conflict or permission refusal, 130 interrupted. Freeze these in CLI contract tests before release.

Ctrl-C cancels queued/model work and discards unused approvals. If a write has begun, finish or reconcile that file before exit; do not claim rollback or blindly retry. Restore terminal state on exit. Untrusted note/model text must not emit terminal controls, OSC hyperlinks, or escape sequences. Source inspection displays sanitized text and local file/line references without running shell commands.

## 3. Providers and budgets

Default and live-test runtime: local Bonsai 2 9B PQ2_0 through PrismML llama.cpp, numeric loopback HTTP `127.0.0.1:18080`, 4,096 context, one slot, thinking disabled. Runtime and weights are user-managed outside the repository. No automatic download/start or silent fallback. Ollama is not a substitute. OpenRouter is an explicit remote option; disclose that permitted passages, questions, instructions, selected research, and bounded conversation history may be sent to it and its routed provider before consent.

All model work enters one cancellable JobQueue. Use provider-specific request builders and strict structured schemas. Bound file sizes, index memory, excerpts, model calls, retrieval hops, elapsed time, output size, and queue depth through named configuration defaults. Validate the 4,096-context budget before sending requests; do not silently truncate approved content. Retain at most three chat turns in memory and recheck evidence/access on every turn.

## 4. Workspace and metadata

Read UTF-8 Markdown only. Include standard Markdown links and local wikilinks as file syntax without requiring a particular editor. Reject absolute or traversing note paths; resolve canonical paths and prevent symlink escapes. Do not follow symlinked files/directories in the first release. Root itself may resolve through a user-selected symlink, after which the canonical root is fixed. Never traverse application state, VCS internals, hidden application directories, excluded folders/tags, or frontmatter exclusions.

Ordinary retrieval notes require `description` (nonblank, <=240 characters), `tags` (1–12 strings, <=64 each), and `aliases` (0–12 strings, <=80 each; `[]` allowed). Invalid/missing metadata stays visible in a local attention view but outside normal retrieval. Missing-field proposals preserve existing frontmatter/body and require review/Apply. Invalid YAML/values and files over the proposed 6,000-character repair limit need manual repair. Metadata aids discovery; factual claims require body evidence. Control files and excluded files are exempt. CLI naming for an ignore key must be finalized in implementation; preserve recognition of existing `vault-synapse: ignore` as an exclusion to prevent accidental disclosure during transition.

## 5. Instructions and research

Defaults: `Synapse/Instructions.md` and `Research.md`, configurable, distinct workspace-relative Markdown paths. Search/chat require neither. Exclude control files from ordinary retrieval; research reads only its explicit source and valid instructions. No Security.md or user-authored permission/masking language.

Instructions contain versioned deterministic routing metadata (destination IDs, paths, IANA timezone, daily folder/heading) and human formatting prose. Prose cannot grant access. Ask for an explicit daily date when ambiguous. Setup may create missing starters only after a separate exact local review; never overwrite existing control files. Models and external clients cannot modify them.

Capture preserves inbox text and stores bounded source/provenance hashes and processing outcomes. Proposal generation uses trusted destination IDs and application-owned evidence. External research and URLs are untrusted; URLs are inert provenance, never automatically fetched or treated as verified workspace citations. Never consume/delete research after processing.

## 6. Write authority and recovery

Only a restricted filesystem adapter can create/update approved Markdown targets. Show full before/after diffs, allow per-file acceptance, then require explicit local Apply of the exact accepted set. No blanket yes flag, persisted approval, model approval, or MCP approval. Bind approval to workspace identity, exact bytes/diff, source and target snapshots, instruction/routing snapshots, exclusions, provider/access configuration, and destination resolution. Any change invalidates the approval. Recheck immediately before each write.

Use atomic per-file replacement where supported, exclusive creation for new files, narrow filesystem operations and per-workspace locking. Multiple files are not a transaction. Define and test the residual race against unrelated editors; do not promise filesystem compare-and-swap. Refuse detected conflicts and symlink/path changes. Do not create unreviewed folders or touch non-Markdown targets. Instructions and inbox are forbidden proposal targets; only a separately scoped MCP append can change the inbox.

Persist recovery intent before any attempt and reconcile actual before/after bytes after crash or uncertain outcome. Distinguish applied, refused, unknown and unattempted files. No replay of uncertain writes. Revert is a new reviewed proposal; a created note reverts to an empty file because deletion is prohibited. Bound recovery history at a proposed 20 records/4,000,000 serialized characters/30 days; retain unresolved entries, refuse new work at capacity, and disclose stored full note text. Deduplication prevents unchanged processed research from being applied twice within retained history.

## 7. MCP and privacy

MCP is optional, disabled by default, numeric-loopback only, and authenticated before request parsing/dispatch. Local user grants independent query/submission scopes. Queries expose permitted evidence with ordinal references, never arbitrary filesystem access. Submission appends labeled unverified research only to the configured inbox with durable idempotency receipts. No direct destination writes or approval API. See [MCP contract](docs/contracts/mcp-v1.md).

Exclusions apply before ingest and again at tools, model inputs, proposals, citations and external responses. Remote consent and MCP scopes are independent. Synapse cannot constrain a process separately granted filesystem access. No telemetry, update pings, prompt logging, note logging, credential logging, or raw exception dumps. Interactive source/diff output is intentional content display; diagnostics remain content-free. Secrets stay out of notes/repository and use environment or OS credential storage. Application state stays outside the workspace, segregated by canonical workspace identity. Clearing history preserves all notes and configuration, revokes grants, and explains loss of recovery/deduplication; synced copies/backups require separate management.

## 8. Acceptance

No inherited TypeScript test count, scaffold installation or previous host smoke proves Rust CLI readiness. Rust compiler checks, formatting, Clippy, architecture/privacy checks, meaningful tests and clean native executable installation must be established in RUST-T01. Release requires the PLAN tasks and [validation matrix](docs/release-validation.md): real TTY behavior, piped JSON, filesystem containment/concurrency, cancellation and crash recovery, cited-answer quality on local Bonsai, scoped native MCP interoperability, privacy checks, and clean standalone installation. Keep gates open until dated reproducible evidence exists.
