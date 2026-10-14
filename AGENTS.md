# AGENTS.md — Synapse

Obsidian plugin: agentic Markdown vault search/chat, reviewed research-to-note updates, and policy-controlled MCP collaboration. **No embeddings, no vector DB, no telemetry.** Desktop only (`isDesktopOnly: true`).

**Provider phasing (binding):**

1. **Phase A (now → feature-complete):** default LLM = **OpenRouter `openrouter/free` router**. Always use `openrouter/free` for live testing and default model selection. API key via settings or `OPENROUTER_API_KEY` (never commit `.env`).
2. **Phase B (only after Must+Should complete):** add/validate **local Ollama**. Do not block feature work on local VRAM or Gate A.

**Docs:** [SPEC.md](SPEC.md) · [DESIGN.md](DESIGN.md) · [PLAN.md](PLAN.md) · [PROGRESS.md](PROGRESS.md)

---

## Commands

Scaffold lands in M1-T02 / T02b / T02c. Until then, these are the target scripts:

| Action | Command |
|--------|---------|
| Install | `npm install` |
| Run (watch) | `npm run dev` |
| Test | `npm test` |
| Lint | `npm run lint` |
| Type-check | `npm run typecheck` |
| Build | `npm run build` → `main.js` |
| Boundaries | `node scripts/check-boundaries.mjs` · `check-no-network.mjs` · `check-no-writes.mjs` · `check-schema-subset.mjs` |
| Deploy (dev) | Copy `main.js`, `manifest.json`, `styles.css` → `<Vault>/.obsidian/plugins/<plugin-id>/` |
| Deploy (release) | GitHub `release.yml` / `npm run release` — artifacts **only** those three files |

CI (once wired): typecheck → lint → boundaries → test → privacy greps → build.

---

## Latest task

User-directed scope revisions take precedence over ordinary task selection. Historical documents under `docs/history/` are not current requirements.

1. Current work = the **`IN_PROGRESS`** task in `PLAN.md`.
2. Else the first **`TODO`** whose dependencies are all **`DONE`** (lowest ID wins ties).
3. If nothing qualifies, **stop** and report what is blocking.

Update status only in `PLAN.md`. `PROGRESS.md` is narrative only (Current focus, Last session, Known issues, Shortcuts taken, Decisions not in DESIGN.md, Rules to add to AGENTS.md). When you add a rule here, clear it from that PROGRESS section.

**Commit format:** `[type]: [summary] (task [ID])`  
Types: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `build`

**Stuck:** After **3 failed attempts** at the same problem, stop. Report what you tried, what you learned, and what you suggest.

---

## Architecture (hard rules)

Ports-and-adapters. Layers and imports: DESIGN §2.

- **`obsidian` / Node / `electron` only in `adapters/obsidian` and `adapters/node`.** Everything else is plain TS + ports.
- Import via each module’s **`index.ts` only** (no deep imports). `main.ts` is the sole composition root — no feature logic there.
- **I/O only through ports** (`VaultPort`, `StoragePort`, `Transport`, …). Features never call Obsidian/Node APIs directly.
- **Plugin state writes only via `StoragePort`** (plugin folder). User Markdown create/update only via the planned restricted `NoteWritePort` adapter after local diff approval; scoped MCP submission may append only to Research.md. Until that adapter/checker migration lands, the existing vault-write ban remains enforced. No deletion/rename or assistant updates to control files; a separate reviewed setup flow may create missing starter control files only.
- **Network only in allowlisted transport files.** Phase A allowlist = OpenRouter API hosts; Phase B adds loopback Ollama. MCP may use a separately allowlisted authenticated local server adapter; this grants no arbitrary egress. No bare `fetch` in features; no telemetry.
- **Exclusion at ingest** (`corpus` + `policy`). Excluded notes must never appear in tools, model context, research proposals, or MCP responses. Internal access does not imply remote-model or external-client permission.
- **Model I/O:** structured schemas only (zod); one request builder per provider; model returns bounded structured terms/enums/booleans/text/ledger or destination IDs. Proposed Markdown is untrusted; never accept model-supplied trusted paths, regex, quotes, security grants, or approval. Citations resolve from plugin-owned evidence.
- **One model lane:** all model work through `JobQueue`. UI uses pure viewmodels + `textContent` (no `innerHTML` from untrusted text).
- CSS selectors prefixed `.syn-`; UI strings in `ui/strings/`; identity/tunables in `src/constants.ts`.

---

## Vault control and collaboration rules

- Defaults: `Synapse/Instructions.md`, `Synapse/Security.md`, `Research.md`; configurable, user-editable vault files. Never overwrite on setup.
- Security rules are deterministically schema-validated; missing/invalid policy denies MCP access and note application. Deny overrides allow; masking precedes remote disclosure.
- Research and MCP requests are untrusted. External clients cannot approve note changes or modify control files. Approval binds exact diff and current source/target/policy/instruction snapshots.
- PDFs/page citations and contradiction detection are removed from release scope. Daily resurfacing is also removed from the current release scope.

## Style (not fully lint-enforced)

- Strict TypeScript; branded paths (`VaultPath`); facades return `Result<T>` (ports may throw typed errors).
- Colocate `*.test.ts`; shared fakes/contracts/integration under `test/`.
- Never log prompts, note text, excerpts, or API keys. Paths → `h:` + 8 hex of SHA-1.
- Provisional numbers live in `constants.ts` / settings — not magic literals.
- Prefer small tasks (1–5 files). Do not parallelize work that shares `main.ts`, `styles.css`, or the same module `index.ts`.

---

## Hard prohibitions

- Never disable, skip, or weaken tests to make them pass; never delete failing tests without a real fix.
- Never edit generated files (e.g. `recommended.generated.json`, built `main.js`) by hand — regenerate via harness/build.
- Never commit secrets, API keys, or vault note content (`.env` is gitignored).
- Never add embeddings, vector DBs, telemetry, autonomous note application, or runtimes beyond **OpenRouter (Phase A)** and **Ollama (Phase B)** (SPEC §3 / DESIGN §11 / ADR-21).
- Never start Phase B local bake-off / Gate A before revised SPEC Must+Should feature-complete.

---

## Definition of done

Per PLAN + DESIGN §9.4: acceptance criteria met; status → `DONE` in `PLAN.md`; required tests green; no illegal imports/writes/network; no note text or keys in logs; plugin still **builds and loads**; smoke `npm run build` when the toolchain exists.
