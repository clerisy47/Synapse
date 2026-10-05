# Vault Synapse

An Obsidian plugin where an LLM answers questions, flags contradictions, and resurfaces old notes by searching your vault's links, tags, and text. No embeddings, no vector database, no telemetry.

**Plugin ID:** `vault-synapse` · **Desktop only** · **MIT**

## Provider phases

| Phase | When | Default model backend |
|-------|------|------------------------|
| **A — Build** | Until features are complete | [OpenRouter](https://openrouter.ai) **free** models (`:free`) |
| **B — Local** | After feature-complete only | [Ollama](https://ollama.com) on loopback |

Phase A sends selected note excerpts used in AI jobs to OpenRouter. Phase B targets on-device inference.

## Requirements (Phase A)

- Obsidian desktop ≥ 1.5.0
- OpenRouter API key with access to free models
- Dev: copy `.env.example` → `.env` and set `OPENROUTER_API_KEY=...` (never commit `.env`)

Provisional default model: `qwen/qwen3.8-27b:free` (pinned `:free` ID; prefer over `openrouter/free` for stable JSON).

## Install (dev)

1. Build release artifacts (`main.js`, `manifest.json`, `styles.css`) once the toolchain lands.
2. Copy them into `<Vault>/.obsidian/plugins/vault-synapse/`.
3. Enable **Vault Synapse** under Settings → Community plugins.
4. Paste your OpenRouter API key in settings and run the health check.

## Privacy

- Phase A: AI features call `openrouter.ai` only (allowlisted). First-use UI warns that excerpts leave the machine.
- No telemetry / analytics / update pings.
- Never edits your notes. Plugin state lives only under the plugin folder.
- Exclude notes with frontmatter: `vault-synapse: ignore`
