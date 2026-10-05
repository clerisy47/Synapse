# AGENTS.md — Synapse

Obsidian plugin: tool-based vault Q&A, contradiction flags, and resurfacing. **No embeddings, no vector DB, no telemetry.** Desktop only (`isDesktopOnly: true`).

**Provider phasing (binding):**

1. **Phase A (now → feature-complete):** default LLM = **OpenRouter free models** (`:free` / pinned IDs). API key via settings or `OPENROUTER_API_KEY` (never commit `.env`).
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
- **File writes only via `StoragePort`** (plugin folder). Never use vault write APIs; never edit user notes.
- **Network only in allowlisted transport files.** Phase A allowlist = OpenRouter API hosts; Phase B adds loopback Ollama. No bare `fetch` in features; no telemetry.
- **Exclusion at ingest** (`corpus` + `policy`). Excluded notes must never appear in tools, model context, flags, or resurfacing.
- **Model I/O:** structured schemas only (zod); one request builder per provider; model returns enums/terms/booleans/ledger IDs — never paths, regex, or quotes.
- **One model lane:** all model work through `JobQueue`. UI uses pure viewmodels + `textContent` (no `innerHTML` from untrusted text).
- CSS selectors prefixed `.syn-`; UI strings in `ui/strings/`; identity/tunables in `src/constants.ts`.

---

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
- Never add embeddings, vector DBs, telemetry, note-editing, or runtimes beyond **OpenRouter (Phase A)** and **Ollama (Phase B)** (SPEC §3 / DESIGN §11 / ADR-21).
- Never start Phase B local bake-off / Gate A before Must+Should feature-complete.

---

## Definition of done

Per PLAN + DESIGN §9.4: acceptance criteria met; status → `DONE` in `PLAN.md`; required tests green; no illegal imports/writes/network; no note text or keys in logs; plugin still **builds and loads**; smoke `npm run build` when the toolchain exists.
