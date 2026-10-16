# Vault Synapse

A desktop Obsidian assistant for agentic Markdown vault search and cited chat. The revised roadmap adds editable vault instructions, reviewed research-to-note updates, and policy-controlled MCP collaboration with external research agents. No embeddings, vector database, or telemetry.

**Plugin ID:** `vault-synapse` · **Desktop only** · **MIT**

## Current implementation and roadmap

OpenRouter runtime, vault tools, evidence, and sidebar chat are implemented with automated tests. Editable control files and recipient policy enforcement are implemented. Local research selection capture and its persistent provenance/processing ledger are implemented. Bounded proposal generation and local diff review/approval are implemented, with user-confirmed real Obsidian review smoke. Restricted note application, durable recovery and authenticated scoped MCP collaboration are implemented with synthetic/headless checks; actual Obsidian/client workflow validation remains at the Phase A gate. R1-T01 cleanup is complete: ingestion and citations are Markdown-only, and older settings/state drop retired feature data. PDF search/page citations, contradiction finding, and daily resurfacing are outside the revised release scope. See [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md).

## Provider phases

Phase A uses OpenRouter **`openrouter/free`** for development, testing, and feature completion. Selected permitted note content leaves the machine. Only after every Must + Should feature is complete and verified will Phase B add and default to local Ollama. No silent remote fallback is planned.

## Requirements and development install

- Obsidian desktop ≥ 1.8.7.
- OpenRouter API key for Phase A. Dev: copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, and never commit it.
- Run `npm install` and `npm run build`; copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/vault-synapse/`.
- Enable the plugin, configure the API key, and run health check.

## Planned vault workflow

`Synapse/Instructions.md` defines formatting and routing; `Synapse/Security.md` defines enforceable sharing/write rules; `Research.md` holds rough research. Defaults are configurable and user-editable. Starter files require review and never overwrite existing files.

To capture research now, save the configured inbox, select nonempty material, and run **Capture research selection**. Capture preserves the inbox and records hashes and processing metadata in plugin state. It sends no model request and performs no note writes. Repeated unchanged material retains its existing status. See [research capture details](docs/r3-t01-research-audit.md).

Run **Review research** on a saved inbox selection to choose configured destinations and an explicit daily-note date, generate complete before/after Markdown, and accept/reject each change before batch approval. Review and approvals stay in memory. After approval, **Apply approved changes** saves only the accepted subset with fresh conflict and permission checks. Closing discards unused approval and cancels remaining writes. Edits to source/targets/controls or settings invalidate review and remove its content. Per-file results distinguish applied, refused, unknown and unattempted writes; research is preserved. Attempted batches cannot be generated again. Run **Review recovery and revert** to inspect reconciled outcomes and review a fresh revert diff; a new approval and Apply are required. Reverting a created note leaves an empty Markdown file. Create destination folders yourself. See the [apply smoke checklist](docs/r3-t04-apply-smoke.md).

Enable local MCP in settings and provision a bearer with explicit independent query/submission scopes. Queries use permitted OpenRouter context and return masked extractive answers with ordinal references. Submissions preserve the inbox and append quoted, unverified research; identical client/key/payload retries return the same durable receipt for 30 days. An append can invalidate its own HTTP response: initialize again and retry the same key/payload. Uncertain writes are reconciled conservatively. See the [collaboration audit](docs/r4-t03-collaboration-audit.md). External MCP clients can request permitted or masked information and submit research using granted capabilities. They cannot directly edit destination notes or approve changes. This protects access through Synapse; it cannot constrain an agent separately granted filesystem access.

## Privacy

- Phase A sends selected context to OpenRouter only through allowlisted transports, with first-use disclosure. Local-only privacy arrives in Phase B.
- No telemetry, analytics, or update pings. Exclude notes with `vault-synapse: ignore` frontmatter or configured folder/tag rules.
- Target-note changes require local review, approval and explicit Apply through a restricted adapter. Separately authorized MCP submissions can append only to the configured research inbox.
- Diagnostics contain static event names only, with no exception messages, stacks, note paths, prompts, research or keys. The debug recent-notes command shows only a policy-filtered count.
- Plugin state stays in the plugin folder. Recovery records contain full before/after target note text and trusted paths and may be copied by vault sync or backups. Recovery is capped at 20 records and 4,000,000 serialized characters, with 30-day expiry processed on startup/access; unresolved writes remain retained and a full journal refuses new work. Run **Clear plugin data** to review the warning and erase plugin history while preserving settings and every vault file. Synapse stops until you reload it. Clearing loses recovery/revert and duplicate-prevention history, MCP receipts and client pairings; processed research can be proposed again and resubmissions can duplicate inbox entries. Settings retain the configured API key. Synced copies and backups must be managed separately. See the [recovery audit](docs/r3-t05-recovery-audit.md).

## Runtime security controls

Create the reviewed starter files manually using the control-file commands; setup
still writes nothing. A valid Security.md is required for access-bound search/chat.
The starter permits internal reads and denies remote/client disclosure. Explicit
remote read permission is needed to include note evidence in OpenRouter prompts.
Deny rules win; missing/invalid rules fail closed. Provider consent and exclusions
remain independent restrictions.

Remote evidence supports deterministic field/literal masking. Raw path-based tools
deny masked notes when they cannot enforce the projection safely. Policy, source,
metadata or exclusion changes cancel pending chat and clear retained history;
repeat the question after the controls/index refresh. Chat retains at most three
current-policy Q/A pairs when multi-turn is enabled. Details and representation
limits are in [control contracts](docs/control-contracts.md).

Research proposals and chat history stay in memory. The research ledger retains bounded batch hashes, source paths and processing outcomes (no research body); MCP receipts retain hashes and inbox paths for 30 days, with unresolved intents retained. MCP grants persist hashed bearers until revoked or cleared. Settings, including a configured API key, live in `data.json` and may also be synced or backed up. Chat, research generation and MCP queries can send permitted/masked context, questions and recent chat history to OpenRouter and its routed provider; review/apply/revert and MCP inbox submission do not require model egress. No telemetry is sent.
