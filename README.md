# Vault Synapse

A desktop Obsidian assistant for agentic Markdown vault search and cited chat. The revised roadmap adds editable vault instructions, reviewed research-to-note updates, and policy-controlled MCP collaboration with external research agents. No embeddings, vector database, or telemetry.

**Plugin ID:** `vault-synapse` · **Desktop only** · **MIT**

## Current implementation and roadmap

OpenRouter runtime, vault tools, evidence, and sidebar chat are implemented with automated tests. Editable control files and recipient policy enforcement are implemented. Local research selection capture and its persistent provenance/processing ledger are implemented. Bounded proposal generation and local diff review/approval are implemented, with user-confirmed real Obsidian review smoke. Restricted note application, durable recovery and authenticated scoped MCP collaboration are implemented with synthetic/headless checks; actual Obsidian/client workflow validation remains at the Phase A gate. R1-T01 cleanup is complete: ingestion and citations are Markdown-only, and older settings/state drop retired feature data. PDF search/page citations, contradiction finding, and daily resurfacing are outside the revised release scope. See [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md).

## Provider

Default inference uses local **Bonsai 2 4B PQ2_0 through PrismML llama.cpp**. See [installation, startup and troubleshooting](docs/bonsai.md). OpenRouter remains an explicit remote option; no silent fallback. Full quality and real Obsidian workflow verification remain pending.

## Requirements and development install

- Obsidian desktop ≥ 1.8.7.
- User-managed Prism llama.cpp runtime and Bonsai weights outside the repository; follow [Bonsai setup](docs/bonsai.md). OpenRouter needs a key only when explicitly selected.
- Run `npm install` and `npm run build`; copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/vault-synapse/`.
- Enable the plugin, start the local server, and run health check.

## Planned vault workflow

`Synapse/Instructions.md` defines formatting and routing; `Research.md` holds rough research. Defaults are configurable and user-editable. Starter files require review and never overwrite existing files.

To capture research now, save the configured inbox, select nonempty material, and run **Capture research selection**. Capture preserves the inbox and records hashes and processing metadata in plugin state. It sends no model request and performs no note writes. Repeated unchanged material retains its existing status. See [research capture details](docs/r3-t01-research-audit.md).

Run **Review research** on a saved inbox selection to choose configured destinations and an explicit daily-note date, generate complete before/after Markdown, and accept/reject each change before batch approval. Review and approvals stay in memory. After approval, **Apply approved changes** saves only the accepted subset with fresh conflict and permission checks. Closing discards unused approval and cancels remaining writes. Edits to source/targets/controls or settings invalidate review and remove its content. Per-file results distinguish applied, refused, unknown and unattempted writes; research is preserved. Attempted batches cannot be generated again. Run **Review recovery and revert** to inspect reconciled outcomes and review a fresh revert diff; a new approval and Apply are required. Reverting a created note leaves an empty Markdown file. Create destination folders yourself. See the [apply smoke checklist](docs/r3-t04-apply-smoke.md).

Enable local MCP in settings and provision a bearer with explicit independent query/submission scopes. Queries use permitted context through the selected provider and return extractive answers with ordinal references. Submissions preserve the inbox and append quoted, unverified research; identical client/key/payload retries return the same durable receipt for 30 days. An append can invalidate its own HTTP response: initialize again and retry the same key/payload. Uncertain writes are reconciled conservatively. See the [collaboration audit](docs/r4-t03-collaboration-audit.md). External MCP clients can request information from non-excluded notes and submit research using granted capabilities. They cannot directly edit destination notes or approve changes. This protects access through Synapse; it cannot constrain an agent separately granted filesystem access.

## Privacy

- Bonsai inference stays on numeric loopback. Explicit OpenRouter selection sends permitted context remotely with provider consent and exclusions.
- No telemetry, analytics, or update pings. Exclude notes with `vault-synapse: ignore` frontmatter or configured folder/tag rules.
- Target-note changes require local review, approval and explicit Apply through a restricted adapter. Separately authorized MCP submissions can append only to the configured research inbox.
- Diagnostics contain static event names only, with no exception messages, stacks, note paths, prompts, research or keys. The debug recent-notes command shows only a exclusion-filtered count.
- Plugin state stays in the plugin folder. Recovery records contain full before/after target note text and trusted paths and may be copied by vault sync or backups. Recovery is capped at 20 records and 4,000,000 serialized characters, with 30-day expiry processed on startup/access; unresolved writes remain retained and a full journal refuses new work. Run **Clear plugin data** to review the warning and erase plugin history while preserving settings and every vault file. Synapse stops until you reload it. Clearing loses recovery/revert and duplicate-prevention history, MCP receipts and client pairings; processed research can be proposed again and resubmissions can duplicate inbox entries. Settings retain the configured API key. Synced copies and backups must be managed separately. See the [recovery audit](docs/r3-t05-recovery-audit.md).

## Access controls

Search and chat require no vault control file. Security.md support has been removed;
legacy security-path settings are ignored and existing vault files are left untouched.
All non-excluded notes are eligible for the selected provider. OpenRouter requires
explicit selection and disclosure consent. MCP requires local enablement, pairing
and query/submission scopes; query scope covers all non-excluded notes. There are
no per-recipient file grants or configurable masks.

Research still requires valid Instructions.md routing. Note changes require exact
local diff approval and explicit Apply. Source, target, instruction, metadata and
exclusion changes invalidate stale work. Chat retains at most three current turns.

Research proposals and chat history stay in memory. The research ledger retains bounded batch hashes, source paths and processing outcomes (no research body); MCP receipts retain hashes and inbox paths for 30 days, with unresolved intents retained. MCP grants persist hashed bearers until revoked or cleared. Settings, including a configured API key, live in `data.json` and may also be synced or backed up. Chat, research generation and MCP queries can send non-excluded context, questions and recent chat history to OpenRouter and its routed provider; review/apply/revert and MCP inbox submission do not require model egress. No telemetry is sent.

Runtime binaries/weights are never release artifacts.


Ordinary notes now need `description`, `tags`, and `aliases` YAML before retrieval. Description is a nonblank subject/scope summary (max 240 characters); tags is a list of 1–12 relevant strings (max 64 each); aliases is a list of 0–12 alternative names (max 80 each), with `[]` valid. Run **Review note metadata** to see the attention count and affected notes. Missing-field proposals preserve existing frontmatter and body bytes and require exact local approval followed by Apply. Existing invalid values/YAML and notes above 6,000 characters need manual repair. Excluded notes and control files are exempt; search/chat require no control files. Unrepaired notes remain in the local repair view but are excluded from normal retrieval. Metadata guides discovery; factual answers use bodies. See [contract](SPEC.md#8-mandatory-retrieval-metadata-2026-10-17-scope-revision) and [measured results and limits](docs/metadata-evaluation.md).
