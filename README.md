# Vault Synapse

A desktop Obsidian assistant for agentic Markdown vault search and cited chat. The revised roadmap adds editable vault instructions, reviewed research-to-note updates, and policy-controlled MCP collaboration with external research agents. No embeddings, vector database, or telemetry.

**Plugin ID:** `vault-synapse` · **Desktop only** · **MIT**

## Current implementation and roadmap

OpenRouter runtime, vault tools, evidence, and sidebar chat are implemented with automated tests. Research updates, control-file policy, diff approval, and MCP are planned. R1-T01 cleanup is complete: ingestion and citations are Markdown-only, and older settings/state drop retired feature data. PDF search/page citations, contradiction finding, and daily resurfacing are outside the revised release scope. See [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md).

## Provider phases

Phase A uses OpenRouter **`openrouter/free`** for development, testing, and feature completion. Selected permitted note content leaves the machine. Only after every Must + Should feature is complete and verified will Phase B add and default to local Ollama. No silent remote fallback is planned.

## Requirements and development install

- Obsidian desktop ≥ 1.8.7.
- OpenRouter API key for Phase A. Dev: copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, and never commit it.
- Run `npm install` and `npm run build`; copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/vault-synapse/`.
- Enable the plugin, configure the API key, and run health check.

## Planned vault workflow

`Synapse/Instructions.md` defines formatting and routing; `Synapse/Security.md` defines enforceable sharing/write rules; `Research.md` holds rough research. Defaults are configurable and user-editable. Starter files require review and never overwrite existing files.

Synapse will show note-change diffs for local approval. External MCP clients can request permitted or masked information and submit research using granted capabilities. They cannot directly edit destination notes or approve changes. This protects access through Synapse; it cannot constrain an agent separately granted filesystem access.

## Privacy

- Phase A sends selected context to OpenRouter only through allowlisted transports, with first-use disclosure. Local-only privacy arrives in Phase B.
- No telemetry, analytics, or update pings. Exclude notes with `vault-synapse: ignore` frontmatter or configured folder/tag rules.
- Current implementation does not edit notes. Planned writes require a restricted adapter and approval, except explicitly authorized MCP inbox appends.
- Plugin state stays in the plugin folder. Future proposal/recovery records may contain note text and be synced with that folder; retention and clear-data controls are required before shipping them.
