# PLAN.md: Synapse

Status: draft v1.1 · Inputs: `SPEC.md` (draft v1.1), `DESIGN.md` (draft v1.1)  
Rule: every milestone leaves a **working, installable plugin**. Milestone 1 is the thinnest end-to-end slice that builds, loads in Obsidian, and deploys as `main.js` + `manifest.json` + `styles.css`.

**Provider phasing (SPEC §0 / ADR-21).** Phase A (this plan through feature-complete): **OpenRouter free models**. Phase B (new milestone after M7/M8): **local Ollama** + Gate A — do **not** schedule local bake-off work before then.

**Task format.** Each task touches **1–5 files**, is one session of work, and ships with tests where the design requires them. Status values: `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`.

**How to use parallel marks.** Tasks tagged **∥** within the same Parallel group may run concurrently because they do not edit the same files. Serial tasks must finish before their dependents start.

---

## Milestone map

| # | Name | Leaves the app able to… | Primary SPEC |
|---|------|-------------------------|--------------|
| **1** | Walking skeleton | Install, load, configure OpenRouter key/model, health-check free models, show status, survive without a key | M1 (thin), M8/M9 scaffold |
| **2** | Vault corpus + tools | Index notes with exclusions; invoke all eight tools against a vault | M2 tools, M8.4 |
| **3** | Q&A chat | Ask a question in a sidebar; get cited answers + hop trace | M2 loop, M3, S2 stub |
| **4** | PDF text layer | Search/read text-layer PDFs; list unsupported PDFs in settings | M4 |
| **5** | Compare + contradictions | Run contradiction check; see gutter + Flags list; dismiss | M5, M6, S1 |
| **6** | Resurfacing | Daily/manual resurface panel with reasons and dismiss/downweight | M7 |
| **7** | Privacy & Shoulds | Allowlist egress proofs; clear-all; multi-turn; polish | M8, S2, S3 |
| **8** | Eval & release (Phase A) | Fixture vault, Gate metrics on OpenRouter free models, community-ready artifacts | M9, S4 (cloud), Gates (Phase A) |
| **9** | Phase B — Local Ollama | Ollama client, loopback defaults, Gate A on-device bake-off, recommended local models | SPEC §0 Phase B |

---

## Risks → early tasks

Address these before they block a vertical slice.

| Risk | Why it matters | Addressed by |
|------|----------------|--------------|
| **R1** Manifest ID `synapse` is taken (F-07) | Blocks any public build; locks folder, commands, exclusion key | M1-T01 |
| **R2** Transport cannot cancel / stream (OQ-1, F-01, Gate B/C) | Breaks AC-M1.6 and “progress in 3 s” | M1-T08, M1-T09, M1-T18, M8-T03 |
| **R3** Free-model schema / rate limits (OQ-5, OQ-6) | Phase A quality and “recommended” list wrong if pinned model flakes | M1-T10, M1-T17 (OpenRouter); **local 8 GB bake-off deferred to M9** |
| **R4** Structured output / `think` unreliable (OQ-6, F-08) | Every AI feature fails closed or silently | M1-T10, M1-T17 |
| **R5** Latency budgets unmet (F-03) | Q&A/contradiction miss 45 s / 60 s targets | M1-T17, M3-T03, M8-T02 |
| **R6** Exclusion leaks (ADR-08) | Privacy regression; AC-M2.7 / M8.4 | M2-T01, M2-T02, M7-T04 |
| **R7** pdf.js unavailable from plugin (OQ-4, Gate B) | PDF milestone blocked or large bundle | M4-T01 (probe before ingest) |
| **R8** Sync-hostile `data.json` / bad merge (AC-M8.7) | Plugin fails to load after conflict | M1-T06, M1-T07 |
| **R9** Backlinks API not public (OQ-2) | Community-review rejection | M2-T04 |
| **R10** Citation scroll / PDF `#page=` undocumented (F-23) | Broken citation UX | M3-T08, M4-T01 |

---

## Milestone 1 — Walking skeleton

**Goal.** Thinnest slice that **runs and deploys**: TypeScript plugin builds to release artifacts, loads in Obsidian (`isDesktopOnly`), shows a settings tab (OpenRouter API key + free model) and status bar, health-checks OpenRouter with the **production request shape**, disables AI cleanly when the key is missing or the API is down, and never writes outside the plugin folder.

**Out of scope here.** Search tools, chat, PDFs, contradictions, resurfacing, eval scoring, **Ollama / local models** (Phase B / Milestone 9).

### Parallel groups (M1)

- **∥0:** M1-T02b · M1-T02c (after M1-T02)
- **∥A:** M1-T03 · M1-T04 · M1-T05 (after M1-T02b; T04 follows T03)
- **∥B:** M1-T08 · M1-T11 (after M1-T04)
- **∥C:** M1-T12 · M1-T13 (after M1-T06 / M1-T07 respectively)
- **∥D:** M1-T14 · M1-T15 (after M1-T11 / M1-T12+T13)

---

### M1-T01 — Decide identity and freeze constants
- **Description:** Pick a unique plugin ID / display name / exclusion frontmatter key; write `src/constants.ts` and align `manifest.json` (F-07, ADR-17).
- **Files:** `src/constants.ts`, `manifest.json`, `versions.json`, `LICENSE`, `README.md`
- **Dependencies:** none
- **Acceptance criteria:** ID is not taken on the community plugin list; `PLUGIN_ID`, view-type prefixes, and exclusion key all derive from constants; `isDesktopOnly: true`; MIT present.
- **How to verify:** Grep shows no hard-coded old ID; open `manifest.json` and confirm fields; spot-check community plugin directory for collisions.
- **Status:** DONE

### M1-T02 — Scaffold package and build
- **Description:** Package/tsconfig/esbuild; empty `main.ts` that loads; produce `main.js`.
- **Files:** `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `src/main.ts`, `styles.css`
- **Dependencies:** M1-T01
- **Acceptance criteria:** `npm run build` produces `main.js`; load in a vault’s plugin folder enables with no throw.
- **How to verify:** Local build; enable plugin in Obsidian.
- **Status:** DONE

### M1-T02b — Test runner, lint, and CI
- **Description:** Vitest, eslint (incl. Obsidian plugin + import bans), dependency-cruiser, CI workflow.
- **Files:** `vitest.config.ts`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`, `package.json`
- **Dependencies:** M1-T02
- **Acceptance criteria:** `npm test` runs; CI typecheck + lint + test + build; import bans wired (empty allowlists OK).
- **How to verify:** Local test + lint; CI config validates.
- **Status:** DONE  
- **∥** with M1-T02c after M1-T02

### M1-T02c — Boundary and privacy check scripts
- **Description:** Add boundary/network/write check scripts with allowlists for the two transport files (none yet).
- **Files:** `scripts/check-boundaries.mjs`, `scripts/check-no-network.mjs`, `scripts/check-no-writes.mjs`, `.github/workflows/ci.yml`
- **Dependencies:** M1-T02
- **Acceptance criteria:** Scripts exit 0 on skeleton tree; CI invokes them; AC-M8.3 path is ready.
- **How to verify:** Run scripts; introduce a forbidden `fetch` in `src/` and confirm failure.
- **Status:** DONE  
- **∥** with M1-T02b after M1-T02

### M1-T03 — Core types and Result/Error
- **Description:** Brand types, `Result`, `SynapseError` / `ErrorCode` list, pure helpers stubs (`foldCase`, hash, tokens).
- **Files:** `src/core/types.ts`, `src/core/result.ts`, `src/core/errors.ts`, `src/core/text.ts`, `src/core/index.ts`
- **Dependencies:** M1-T02b
- **Acceptance criteria:** Types match DESIGN §4.1; `foldCase` length-preserving property test exists; no imports outside `core`.
- **How to verify:** Unit tests; boundary lint.
- **Status:** DONE  
- **∥A**

### M1-T04 — Port interfaces and Clock/Logger/Observable
- **Description:** Freeze I/O ports plus `Clock` / `Logger` / `Observable`.
- **Files:** `src/core/ports.ts`, `src/core/clock.ts`, `src/core/logger.ts`, `src/core/observable.ts`, `src/core/index.ts`
- **Dependencies:** M1-T03
- **Acceptance criteria:** Ports match DESIGN §5.1–5.2; Phase 0 freeze complete for interfaces.
- **How to verify:** Typecheck; no concrete Obsidian/Node imports in `core/`.
- **Status:** DONE  
- **∥A** (after T03; sequential with T03 inside ∥A)

### M1-T05 — Model-output schemas (zod) + subset check
- **Description:** Define the seven structured-output schemas; restrict emitted JSON Schema keywords.
- **Files:** `src/llm/schemas.ts`, `scripts/check-schema-subset.mjs`, `src/llm/schema-subset.test.ts`, `.github/workflows/ci.yml`
- **Dependencies:** M1-T03
- **Acceptance criteria:** Schemas cover health, plan, select, answer, claims, compare×2; subset check in CI; free-form parse paths do not exist.
- **How to verify:** CI schema check; unit test that invalid shapes fail validation.
- **Status:** DONE  
- **∥A**

### M1-T06 — Config store (zod settings)
- **Description:** Settings schema, defaults, clamps, `ConfigStore` observable, migration stub.
- **Files:** `src/config/settings.ts`, `src/config/defaults.ts`, `src/config/store.ts`, `src/config/migrate.ts`, `src/config/index.ts`
- **Dependencies:** M1-T03, M1-T04
- **Acceptance criteria:** Invalid fields fall back to defaults; bounds clamped; endpoint/model/`numCtx`/transport/exclusions present per DESIGN §4.5.
- **How to verify:** Unit tests for bad JSON and bound clamping.
- **Status:** DONE

### M1-T07 — State store: tolerant parse + merge
- **Description:** `parsePersisted` never throws; `mergeState` LWW rules; debounced write via `StoragePort`; unknown fields preserved.
- **Files:** `src/state/parse.ts`, `src/state/merge.ts`, `src/state/store.ts`, `src/state/merge.test.ts`, `src/state/index.ts`
- **Dependencies:** M1-T04, M1-T06
- **Acceptance criteria:** AC-M8.7; merge property tests (commutative/associative/idempotent); no note text in `data.json`.
- **How to verify:** Property + unit tests with `MemoryStorage`.
- **Status:** DONE

### M1-T08 — Fake ports for CI
- **Description:** Skeleton fakes: `FakeClock`, `FakeTransport`, `MemoryStorage`, `ScriptedModel`, ring-buffer logger.
- **Files:** `test/fakes/fake-clock.ts`, `test/fakes/fake-transport.ts`, `test/fakes/memory-storage.ts`, `test/fakes/scripted-model.ts`, `test/fakes/index.ts`
- **Dependencies:** M1-T04
- **Acceptance criteria:** Fakes implement ports; usable from vitest without Obsidian/Ollama.
- **How to verify:** Smoke test imports each fake.
- **Status:** DONE  
- **∥B**

### M1-T09 — Node HTTP transport
- **Description:** Guarded dynamic `import('http'/'https')` transport with abort; contract tests against mock server.
- **Files:** `src/adapters/node/http-transport.ts`, `test/mock-ollama/server.ts`, `test/contract/transport.test.ts`, `src/adapters/node/index.ts`
- **Dependencies:** M1-T04, M1-T08
- **Acceptance criteria:** Streaming NDJSON read; abort closes socket; only this file (+ requestUrl later) may open network; addresses R2.
- **How to verify:** Contract tests; abort timing test (milliseconds on mock).
- **Status:** DONE  
- **∥B** (after T08)

### M1-T10 — OpenRouter client + health checker
- **Description:** `OpenRouterClient` (`ModelPort`), chat completions + structured JSON, schema validate + one retry, `HealthChecker` using the **identical** production request shape; classify auth failures, rate limits, `FORMAT_IGNORED`.
- **Files:** `src/llm/request.ts`, `src/llm/client.ts`, `src/llm/health.ts`, `src/llm/validate.ts`, `src/llm/index.ts`
- **Dependencies:** M1-T05, M1-T09, M1-T08
- **Acceptance criteria:** AC-M1.1–1.4 (on mock); API key required; default pinned `:free` model; never auto-purchases credits; Ollama deferred to Milestone 9.
- **How to verify:** Unit tests with `FakeTransport` / mock OpenRouter; optional live probe via `OPENROUTER_API_KEY` (never commit the key).
- **Status:** DONE

### M1-T11 — Job queue (single lane)
- **Description:** Priority queue, cancel, abort-and-resume preemption memoization hooks, status events.
- **Files:** `src/jobs/queue.ts`, `src/jobs/context.ts`, `src/jobs/queue.test.ts`, `src/jobs/index.ts`
- **Dependencies:** M1-T04, M1-T08
- **Acceptance criteria:** AC-M1.5–1.6 semantics (abort+resume, not pause); one job at a time; cancel propagates `AbortSignal`.
- **How to verify:** Unit tests with `FakeClock` and fake long-running steps.
- **Status:** DONE  
- **∥B**

### M1-T12 — Policy: endpoint + exclusion stubs
- **Description:** `EndpointPolicy` (Phase A: OpenRouter allowlist + egress warning; Phase B later: loopback allow) and `ExclusionPolicy` decide API (used later by corpus).
- **Files:** `src/policy/endpoint.ts`, `src/policy/exclusion.ts`, `src/policy/endpoint.test.ts`, `src/policy/exclusion.test.ts`, `src/policy/index.ts`
- **Dependencies:** M1-T03, M1-T06
- **Acceptance criteria:** OpenRouter hosts allowed when configured; other hosts blocked; folder/tag/frontmatter rules fail-closed.
- **How to verify:** Unit tests.
- **Status:** DONE  
- **∥C**

### M1-T13 — Obsidian storage + lifecycle adapters
- **Description:** `StoragePort` path-guarded to plugin folder; load/save `data.json`; plugin lifecycle helpers.
- **Files:** `src/adapters/obsidian/storage.ts`, `src/adapters/obsidian/lifecycle.ts`, `src/adapters/obsidian/request-url-transport.ts`, `src/adapters/obsidian/index.ts`
- **Dependencies:** M1-T04, M1-T07
- **Acceptance criteria:** Writes outside plugin folder rejected; `requestUrl` transport available for health/degraded mode; AC-M8.5 path ready.
- **How to verify:** Unit test of path guard; manual load in Obsidian.
- **Status:** DONE  
- **∥C**

### M1-T14 — Status bar + notices viewmodels/UI
- **Description:** Status-bar indicator (idle/running/paused/error) and non-blocking notices with retry.
- **Files:** `src/ui/viewmodels/status.ts`, `src/ui/status-bar.ts`, `src/ui/notices.ts`, `src/ui/strings/en.ts`, `styles.css`
- **Dependencies:** M1-T11 (status events), M1-T04
- **Acceptance criteria:** AC-M1.7, M1.8; strings centralized; no `innerHTML`.
- **How to verify:** Viewmodel unit tests; manual: trigger error via bad endpoint.
- **Status:** DONE  
- **∥D**

### M1-T15 — Settings tab (endpoint, model, transport warning)
- **Description:** Settings UI via Obsidian `Setting` components; non-loopback warning visible.
- **Files:** `src/ui/settings-tab.ts`, `src/ui/viewmodels/settings.ts`, `src/ui/strings/en.ts`, `styles.css`
- **Dependencies:** M1-T06, M1-T12, M1-T13
- **Acceptance criteria:** AC-M8.2; changing endpoint/model invalidates health; no telemetry toggles.
- **How to verify:** Manual in Obsidian; viewmodel tests for warning state.
- **Status:** DONE  
- **∥D**

### M1-T16 — Wire composition root (deployable slice)
- **Description:** `main.ts` builds adapters → config/state → llm/jobs → UI; sync `onload`; health on `layout-ready`; unload cancels jobs and flushes state.
- **Files:** `src/main.ts`, `src/ui/commands.ts`, `styles.css`, `manifest.json`
- **Dependencies:** M1-T10, M1-T11, M1-T13, M1-T14, M1-T15
- **Acceptance criteria:** Plugin loads with OpenRouter down / key missing (AI disabled, clear message) — AC-M1.3; with provider up, health report shows three facets; unload leaves no listeners (smoke); release artifacts build.
- **How to verify:** Install built files into a vault; enable plugin; toggle key/endpoint; run health from command; unload/reload.
- **Status:** DONE

### M1-T17 — Gate A bake-off (risk burn-down)
- **Description:** On floor hardware, measure structured-output validity, abort behavior, prefill/decode, GPU residency for bake-off tags; record switches in `constants` / notes.
- **Files:** `eval/gates/gate-a.md` (or `docs/gate-a.md`), `src/constants.ts`, `src/llm/models.ts`, `spikes/` (optional runner)
- **Dependencies:** M1-T10, M1-T16 (or standalone spike using same request shape)
- **Acceptance criteria:** Written outcomes for DESIGN §13 Gate A rows; no model marked recommended yet; addresses R3–R5.
- **How to verify:** Report checked into repo; constants updated only where measured.
- **Status:** TODO

### M1-T18 — Walking-skeleton acceptance checklist
- **Description:** Document and run the M1 demo path; fix gaps.
- **Files:** `docs/m1-checklist.md`
- **Dependencies:** M1-T16, M1-T02c
- **Acceptance criteria:** Fresh install → settings → health pass/fail paths → status bar → build artifacts only `main.js`/`manifest.json`/`styles.css`.
- **How to verify:** Checklist all boxes; second machine or clean vault optional. Bugfixes land as separate ≤5-file tasks if needed.
- **Status:** DONE

**Milestone 1 exit:** Plugin is community-install-shaped, Phase A privacy defaults (OpenRouter allowlist + key disclosure) are real, AI harness works on mock + real OpenRouter free models. Local Gate A is **not** required for M1 exit.

---

## Milestone 2 — Vault corpus + search tools

**Goal.** Notes are indexed with exclusion-at-ingest; all eight tools return results; excluded notes never appear. App still loads; Q&A not required yet (optional debug command to invoke a tool).

### Parallel groups (M2)

- **∥E:** M2-T03 · M2-T04 · M2-T05 (after M2-T02 DocTable exists)
- **∥F:** M2-T07 · M2-T08 · M2-T09 (after M2-T06 registry)

---

### M2-T01 — Exclusion policy integration tests
- **Description:** Expand exclusion tests for folder/tag/frontmatter/`ignore`; PDF folder-only rule (F-22).
- **Files:** `src/policy/exclusion.ts`, `src/policy/exclusion.test.ts`, `test/fakes/fake-vault.ts`
- **Dependencies:** M1-T12
- **Acceptance criteria:** Fail-closed rules documented in tests; addresses R6.
- **How to verify:** Unit tests.
- **Status:** DONE

### M2-T02 — Corpus store + DocTable + warm loop
- **Description:** Time-sliced warm over `VaultPort`/`MetadataPort`; `CorpusStatus` observable; apply exclusion at ingest.
- **Files:** `src/corpus/store.ts`, `src/corpus/reader.ts`, `src/corpus/session.ts`, `src/corpus/store.test.ts`, `src/corpus/index.ts`
- **Dependencies:** M2-T01, M1-T04, M1-T08
- **Acceptance criteria:** Unparsed metadata stays out; status `warming|ready`; yield slices respect `SLICE_MS`.
- **How to verify:** FakeVault unit tests; no UI freeze assertion via yield spy.
- **Status:** DONE

### M2-T03 — Text index (folded)
- **Description:** Folded-text body index; `bodyStart` skips frontmatter; snippet cut from original on read.
- **Files:** `src/corpus/text-index.ts`, `src/corpus/text-index.test.ts`, `src/core/text.ts`
- **Dependencies:** M2-T02
- **Acceptance criteria:** Offset round-trip; excluded paths absent; tool-call budget path ready (<2 s target later).
- **How to verify:** Unit + property tests.
- **Status:** DONE  
- **∥E**

### M2-T04 — Link graph (invert resolvedLinks)
- **Description:** Forward + inverse graphs; drop excluded endpoints while building (OQ-2, OQ-11).
- **Files:** `src/corpus/link-graph.ts`, `src/corpus/link-graph.test.ts`, `test/fakes/fake-metadata.ts`
- **Dependencies:** M2-T02
- **Acceptance criteria:** AC-M2.2; no `getBacklinksForFile`; excluded link targets unresolved; addresses R9.
- **How to verify:** Unit tests on synthetic `resolvedLinks`.
- **Status:** DONE  
- **∥E**

### M2-T05 — Tag, title, frontmatter, note-date indexes
- **Description:** Tag/title indexes + frontmatter reader + `NoteDateResolver`.
- **Files:** `src/corpus/tag-index.ts`, `src/corpus/title-index.ts`, `src/corpus/note-dates.ts`, `src/corpus/note-dates.test.ts`
- **Dependencies:** M2-T02
- **Acceptance criteria:** Nested tag expand; aliases in title search; date resolver shared with M7 later.
- **How to verify:** Unit tests.
- **Status:** DONE  
- **∥E**

### M2-T06 — Tool registry + canonical keys
- **Description:** Arg validation, canonical call keys, result caps, duplicate-key helper.
- **Files:** `src/tools/registry.ts`, `src/tools/args.ts`, `src/tools/canonical.ts`, `src/tools/canonical.test.ts`, `src/tools/index.ts`
- **Dependencies:** M2-T02, M1-T03
- **Acceptance criteria:** Identical tool+args key stable; invalid args rejected.
- **How to verify:** Unit tests.
- **Status:** DONE

### M2-T07 — Tools: search_text, search_by_title, read_note
- **Description:** Implement three core tools over `CorpusReader`.
- **Files:** `src/tools/search-text.ts`, `src/tools/search-by-title.ts`, `src/tools/read-note.ts`, `src/tools/search-text.test.ts`
- **Dependencies:** M2-T03, M2-T05, M2-T06
- **Acceptance criteria:** AC-M2.1 cases (typical, empty, excluded) for these tools.
- **How to verify:** Fixture/`FakeCorpus` tests.
- **Status:** DONE  
- **∥F**

### M2-T08 — Tools: links, backlinks, tags
- **Description:** `get_links`, `get_backlinks`, `search_by_tag`.
- **Files:** `src/tools/links.ts`, `src/tools/search-by-tag.ts`, `src/tools/links.test.ts`
- **Dependencies:** M2-T04, M2-T05, M2-T06
- **Acceptance criteria:** AC-M2.1; excluded never returned (AC-M2.7).
- **How to verify:** Unit tests.
- **Status:** DONE  
- **∥F**

### M2-T09 — Tools: frontmatter + list_recent
- **Description:** `get_frontmatter`, `list_recent`.
- **Files:** `src/tools/frontmatter.ts`, `src/tools/list-recent.ts`, `src/tools/list-recent.test.ts`
- **Dependencies:** M2-T05, M2-T06
- **Acceptance criteria:** AC-M2.1 for both.
- **How to verify:** Unit tests.
- **Status:** DONE  
- **∥F**

### M2-T10 — Obsidian vault/metadata adapters + wire corpus
- **Description:** Real `VaultPort`/`MetadataPort`/`ActiveNotePort`; warm on `layout-ready`; debug “run tool” command optional.
- **Files:** `src/adapters/obsidian/vault.ts`, `src/adapters/obsidian/metadata.ts`, `src/adapters/obsidian/active-note.ts`, `src/main.ts`
- **Dependencies:** M2-T02–M2-T09, M1-T16
- **Acceptance criteria:** Plugin indexes a real vault; status shows progress; still works with AI disabled.
- **How to verify:** Manual open vault with exclusions; confirm excluded note absent from tool debug output.
- **Status:** DONE

**Milestone 2 exit:** Tools green in CI; corpus warm in Obsidian; exclusions hold by construction.

---

## Milestone 3 — Q&A sidebar (vertical slice)

**Goal.** User opens chat, asks a question, sees stage progress within 3 s (UI state), receives cited answer or insufficient-evidence, hop trace collapsible. App remains usable if model fails.

### Parallel groups (M3)

- **∥G:** M3-T01 · M3-T02 (after M2 tools)
- **∥H:** M3-T06 · M3-T07 (after M3-T05 pipeline API frozen)

---

### M3-T01 — Evidence segmentation + ledger
- **Description:** Paragraph segmenter, `EvidenceLedger` IDs, display truncation, forged-ID → undefined.
- **Files:** `src/evidence/segment.ts`, `src/evidence/ledger.ts`, `src/evidence/display.ts`, `src/evidence/segment.test.ts`, `src/evidence/index.ts`
- **Dependencies:** M1-T03
- **Acceptance criteria:** Offset property test; IDs `E1…`; quote display ≤300 chars.
- **How to verify:** Unit/property tests.
- **Status:** DONE  
- **∥G**

### M3-T02 — Anchor resolve
- **Description:** Quote-first re-anchoring after edits.
- **Files:** `src/evidence/anchor.ts`, `src/evidence/anchor.test.ts`
- **Dependencies:** M3-T01
- **Acceptance criteria:** Resolve by quote then hint; failure → undefined.
- **How to verify:** Unit tests with edited buffers.
- **Status:** DONE  
- **∥G**

### M3-T03 — Agent state machine + budgets
- **Description:** Pure `next(state,event)`; hop/token/wall-clock/`forceAnswerAfter` budgets; reject invalid transitions.
- **Files:** `src/agent/machine.ts`, `src/agent/budget.ts`, `src/agent/machine.test.ts`, `src/agent/index.ts`
- **Dependencies:** M1-T03, Gate A notes (M1-T17) for provisional numbers
- **Acceptance criteria:** AC-M2.3–2.6 paths; never-satisfied query hits hop cap → insufficient.
- **How to verify:** Exhaustive transition tests with mocked events.
- **Status:** DONE

### M3-T04 — Selectors + prompts
- **Description:** `ModelSelector` default + `TopKSelector` switch; plan/select/answer prompts.
- **Files:** `src/agent/selector.ts`, `src/agent/prompts.ts`, `src/agent/selector.test.ts`
- **Dependencies:** M3-T03, M1-T05, M1-T17
- **Acceptance criteria:** Gate A can flip `top-k` without API break; prompts use ledger IDs only.
- **How to verify:** Unit tests with `ScriptedModel`.
- **Status:** TODO

### M3-T05 — QaPipeline.run (end-to-end core)
- **Description:** Orchestrate plan→search→select→read→answer→verify; citation check + one retry; duplicate tool call counts as hop; job integration.
- **Files:** `src/agent/pipeline.ts`, `src/agent/answer.ts`, `src/agent/chat-session.ts`, `src/agent/pipeline.test.ts`
- **Dependencies:** M3-T01–T04, M2-T06–T09, M1-T10, M1-T11
- **Acceptance criteria:** AC-M2.5, M3.4–3.6 with `ScriptedModel`/`FakeCorpus`; multi-turn memory last-3 (S2 off by default).
- **How to verify:** Pipeline unit/integration tests on mock.
- **Status:** TODO

### M3-T06 — Chat viewmodel + view
- **Description:** Pure viewmodel for messages, stages, trace, citations; DOM shell `ItemView`.
- **Files:** `src/ui/viewmodels/chat.ts`, `src/ui/views/chat-view.ts`, `src/ui/strings/en.ts`, `styles.css`
- **Dependencies:** M3-T05 (types), M1-T14 patterns
- **Acceptance criteria:** AC-M3.1, M3.5; trace collapsed by default; `textContent` only.
- **How to verify:** Viewmodel tests; manual open pane.
- **Status:** TODO  
- **∥H**

### M3-T07 — Commands + ribbon for chat
- **Description:** Open chat command + ribbon icon; submit wires to `JobQueue` + `QaPipeline`.
- **Files:** `src/ui/commands.ts`, `src/main.ts`, `src/ui/views/chat-view.ts`
- **Dependencies:** M3-T05, M3-T06
- **Acceptance criteria:** AC-M3.1; first visible progress is UI stage within 3 s even if model cold.
- **How to verify:** Manual stopwatch on stage badge; cancel control works.
- **Status:** TODO  
- **∥H** (commands after view exists — run T06 first within group)

### M3-T08 — NavigationPort citation clicks
- **Description:** Open note and scroll to passage; PDF page deferred to M4 but interface ready.
- **Files:** `src/adapters/obsidian/navigation.ts`, `src/ui/views/chat-view.ts`, `src/core/ports.ts`
- **Dependencies:** M3-T06, M3-T02
- **Acceptance criteria:** AC-M3.3 for notes; addresses R10 partially.
- **How to verify:** Manual click citation in fixture note.
- **Status:** TODO

### M3-T09 — Q&A integration test (mock Ollama)
- **Description:** End-to-end pipeline over mock HTTP + FakeVault; insufficient + unverified paths.
- **Files:** `test/integration/pipeline-e2e.test.ts`, `test/mock-ollama/server.ts`
- **Dependencies:** M3-T05, M1-T09
- **Acceptance criteria:** Green in CI without real Ollama; AC-M9.4 coverage for harness/machine.
- **How to verify:** `npm test` integration suite.
- **Status:** TODO

**Milestone 3 exit:** Real Q&A in Obsidian against local Ollama + indexed vault; citations navigate.

---

## Milestone 4 — PDF text-layer ingestion

**Goal.** Text-layer PDFs searchable with page numbers; scanned/encrypted/corrupt handled; cache shards; Q&A can cite PDF pages. Notes-only path unchanged if pdf.js missing.

### M4-T01 — Gate B pdf.js / navigation probe
- **Description:** Probe Obsidian `loadPdfJs` (or equivalent); time extraction; confirm `#page=N`; record bundle fallback decision.
- **Files:** `docs/gate-b.md`, `spikes/pdfjs-probe/` (≤3 files), `src/constants.ts`
- **Dependencies:** M1-T16
- **Acceptance criteria:** Written Gate B PDF + navigation outcomes; addresses R7, R10.
- **How to verify:** Probe run notes in `docs/gate-b.md`.
- **Status:** TODO

### M4-T02 — PdfJsPort adapter
- **Description:** Implement `PdfJsPort` per Gate B (Obsidian bundled or `pdfjs-dist`).
- **Files:** `src/adapters/obsidian/pdfjs.ts`, `test/fakes/fake-pdfjs.ts`, `test/contract/pdfjs.test.ts`
- **Dependencies:** M4-T01, M1-T04
- **Acceptance criteria:** Extract text per page without opening viewer; corrupt/encrypted → typed error.
- **How to verify:** Contract tests + fixture PDFs.
- **Status:** TODO

### M4-T03 — Per-page classify + shard cache
- **Description:** Empty-page detection; shard read/write keyed by path+mtime+size+extractor; status list data.
- **Files:** `src/pdf/classify.ts`, `src/pdf/shard.ts`, `src/pdf/classify.test.ts`, `src/state/cache-store.ts`
- **Dependencies:** M4-T02, M1-T07
- **Acceptance criteria:** Per-page rule (ADR-09); rebuild on delete; AC-M4.2–4.4 design interpretation.
- **How to verify:** Unit tests with fixture page texts.
- **Status:** TODO

### M4-T04 — PdfIngest background queue
- **Description:** Yielding ingest; does not freeze UI; skip corrupt with notice + status.
- **Files:** `src/pdf/ingest.ts`, `src/pdf/text-source.ts`, `src/pdf/ingest.test.ts`, `src/pdf/index.ts`
- **Dependencies:** M4-T03, M1-T11 (optional scheduling), M1-T04 Clock
- **Acceptance criteria:** AC-M4.5, M4.6 target (measure at Gate B); `PdfTextSource` for corpus.
- **How to verify:** FakePdfJs + FakeClock tests; manual  many-PDF vault smoke.
- **Status:** TODO

### M4-T05 — Wire PDFs into corpus + tools + navigation
- **Description:** Index PDF pages; `search_text`/`read_note` page-aware; citation opens `#page=N`; settings lists non-ok PDFs.
- **Files:** `src/corpus/store.ts`, `src/tools/search-text.ts`, `src/tools/read-note.ts`, `src/ui/settings-tab.ts`, `src/adapters/obsidian/navigation.ts`
- **Dependencies:** M4-T04, M2-T10, M3-T08
- **Acceptance criteria:** AC-M4.1; Q&A can cite PDF; scanned listed unsupported.
- **How to verify:** Fixture vault manual + unit tests.
- **Status:** TODO

**Milestone 4 exit:** Mixed vault (notes+PDFs) searchable; degraded mode if pdf.js absent.

---

## Milestone 5 — Compare + contradiction detection

**Goal.** Explicit contradiction command; double-pass flags; gutter + Flags sidebar; dismissals persist. On-idle trigger implemented but default off (S1).

### Parallel groups (M5)

- **∥I:** M5-T03 · M5-T04 (after M5-T02)
- **∥J:** M5-T06 · M5-T07 (after M5-T05 store API)

---

### M5-T01 — Shared `compare()` primitive
- **Description:** One code path, tasks `contradiction` | `relevance`; returns relations + `excerpt_ids`; order swap supported.
- **Files:** `src/compare/compare.ts`, `src/compare/prompts.ts`, `src/compare/schemas.ts`, `src/compare/compare.test.ts`, `src/compare/index.ts`
- **Dependencies:** M1-T10, M3-T01, M1-T05
- **Acceptance criteria:** AC-M5.1–5.3 (design: excerpt_ids); only path used by M6/M7.
- **How to verify:** `ScriptedModel` unit tests including order swap.
- **Status:** TODO

### M5-T02 — Claim extraction + candidate gather
- **Description:** Claims schema call; deterministic candidates via tools + one graph hop; session filter.
- **Files:** `src/contradiction/claims.ts`, `src/contradiction/candidates.ts`, `src/contradiction/prompts.ts`, `src/contradiction/claims.test.ts`
- **Dependencies:** M5-T01, M2 tools, M3-T01
- **Acceptance criteria:** AC-M6.2–6.3; trivial notes skip model.
- **How to verify:** Unit tests with FakeCorpus/ScriptedModel.
- **Status:** TODO

### M5-T03 — ContradictionChecker job
- **Description:** Snapshot → claims → candidates → double pass → flag build; active-time budget; resumable steps.
- **Files:** `src/contradiction/checker.ts`, `src/contradiction/checker.test.ts`, `src/contradiction/index.ts`
- **Dependencies:** M5-T01, M5-T02, M1-T11
- **Acceptance criteria:** AC-M6.1, M6.4, M6.8; wording never “error”/“wrong” in static strings.
- **How to verify:** Scripted double-pass tests; banned-word string scan test.
- **Status:** TODO  
- **∥I**

### M5-T04 — FlagStore + dismissals
- **Description:** `cache/flags.json`; dismissal keys in `data.json`; merge-safe.
- **Files:** `src/contradiction/flag-store.ts`, `src/state/dismissals.ts`, `src/contradiction/flag-store.test.ts`
- **Dependencies:** M1-T07, M5-T03 types
- **Acceptance criteria:** AC-M6.7; dismissed pairs stay suppressed across restart/merge.
- **How to verify:** Unit tests with MemoryStorage + merge fixtures.
- **Status:** TODO  
- **∥I**

### M5-T05 — On-idle trigger (S1)
- **Description:** Debounced ≥30 s after last edit; cancel on further edits; default off.
- **Files:** `src/contradiction/on-idle.ts`, `src/contradiction/on-idle.test.ts`, `src/config/settings.ts`
- **Dependencies:** M5-T03, M1-T11, ActiveNotePort
- **Acceptance criteria:** AC-M6.9.
- **How to verify:** FakeClock unit tests.
- **Status:** TODO

### M5-T06 — Flag gutter extension
- **Description:** CM6 gutter; resolve anchors at render; Edit + Live Preview.
- **Files:** `src/ui/editor/flag-gutter.ts`, `styles.css`, `src/ui/strings/en.ts`
- **Dependencies:** M5-T04, M3-T02
- **Acceptance criteria:** AC-M6.5–6.6; stale flags drop markers.
- **How to verify:** Manual in Obsidian; unit test of anchor→marker mapping helper.
- **Status:** TODO  
- **∥J**

### M5-T07 — Flags view + dismiss UI
- **Description:** Sidebar list with side-by-side snippets, dates, jump links, dismiss.
- **Files:** `src/ui/viewmodels/flags.ts`, `src/ui/views/flags-view.ts`, `src/ui/commands.ts`, `styles.css`
- **Dependencies:** M5-T04
- **Acceptance criteria:** AC-M6.5–6.6 UI copy; jump works via NavigationPort.
- **How to verify:** Manual + viewmodel tests.
- **Status:** TODO  
- **∥J**

### M5-T08 — Wire contradiction command + unload cleanup
- **Description:** Register command; ensure unload removes gutter; job preemption under Q&A still works.
- **Files:** `src/main.ts`, `src/ui/commands.ts`, `test/integration/preempt.test.ts`
- **Dependencies:** M5-T03–T07, M3-T05
- **Acceptance criteria:** Full M6 happy path in Obsidian; AC-M9.7 gutter cleanup.
- **How to verify:** Manual checklist; integration preempt test.
- **Status:** TODO

**Milestone 5 exit:** Contradiction vertical slice live; compare reusable for resurfacing.

---

## Milestone 6 — Agentic resurfacing

**Goal.** Once-per-day (and run-now) resurfacing panel; rule score + `compare(relevance)`; dismiss/downweight; never pads.

### Parallel groups (M6)

- **∥K:** M6-T01 · M6-T02 (after M2 corpus + M1 state)

---

### M6-T01 — Active set + mtime window
- **Description:** Active-notes set (F-09); 48 h sliding mtime reliability test; date-field fallback notice.
- **Files:** `src/resurface/active-set.ts`, `src/resurface/mtime-window.ts`, `src/resurface/mtime-window.test.ts`
- **Dependencies:** M2-T05, M1-T07, FakeClock
- **Acceptance criteria:** AC-M7.2–7.3 (design 48 h); fresh install path works.
- **How to verify:** Unit tests with synthetic mtimes.
- **Status:** TODO  
- **∥K**

### M6-T02 — Rule scoring + groupFactor
- **Description:** Backlink/overlap score; dismissal group downweight pure function.
- **Files:** `src/resurface/scoring.ts`, `src/resurface/scoring.test.ts`, `src/state/dismissals.ts`
- **Dependencies:** M1-T07, M2-T04
- **Acceptance criteria:** AC-M7.4 scoring shape; AC-M7.8 with FakeClock.
- **How to verify:** Unit tests.
- **Status:** TODO  
- **∥K**

### M6-T03 — Resurfacer job
- **Description:** Scheduler day marker; candidate pool; ≤15 compares; ≤5 shown; persist today file; fail does not consume day.
- **Files:** `src/resurface/resurfacer.ts`, `src/resurface/candidates.ts`, `src/resurface/store.ts`, `src/resurface/resurfacer.test.ts`, `src/resurface/index.ts`
- **Dependencies:** M6-T01, M6-T02, M5-T01, M1-T11
- **Acceptance criteria:** AC-M7.1, M7.5–7.6, M7.9–7.10; pauses for Q&A via queue.
- **How to verify:** ScriptedModel + FakeClock tests.
- **Status:** TODO

### M6-T04 — Resurface view + dismiss/un-dismiss
- **Description:** Sidebar panel (not popup); reasons + links; dismissed section.
- **Files:** `src/ui/viewmodels/resurface.ts`, `src/ui/views/resurface-view.ts`, `src/ui/commands.ts`, `styles.css`
- **Dependencies:** M6-T03
- **Acceptance criteria:** AC-M7.7–7.8 UI; run-now command.
- **How to verify:** Manual + viewmodel tests.
- **Status:** TODO

### M6-T05 — Wire daily trigger after corpus ready
- **Description:** `layout-ready` → warm → +60 s → `runIfDue`; settings toggles.
- **Files:** `src/main.ts`, `src/ui/settings-tab.ts`, `src/config/settings.ts`
- **Dependencies:** M6-T03, M6-T04, M2-T10
- **Acceptance criteria:** Once per local calendar day; AI-unavailable does not set day marker.
- **How to verify:** Manual clock/day marker inspection; unit test of guard logic.
- **Status:** TODO

**Milestone 6 exit:** All three product surfaces (chat, flags, resurface) work end-to-end.

---

## Milestone 7 — Privacy hardening & Should features

**Goal.** Prove network/write boundaries; clear-all; multi-turn; polish degradations. App feature-complete for Must+Should.

### Parallel groups (M7)

- **∥L:** M7-T01 · M7-T02 · M7-T03

---

### M7-T01 — Network-block integration test
- **Description:** Patch connect/DNS to throw for non-loopback; run feature suite against mock Ollama.
- **Files:** `test/integration/network-block.test.ts`, `src/policy/endpoint.ts`
- **Dependencies:** M3-T09, M5-T08, M6-T05
- **Acceptance criteria:** AC-M8.1.
- **How to verify:** CI integration job.
- **Status:** TODO  
- **∥L**

### M7-T02 — No-writes spy test + lint allowlist freeze
- **Description:** Spy vault write APIs; assert only plugin-folder StoragePort writes.
- **Files:** `test/integration/no-writes.test.ts`, `scripts/check-no-writes.mjs`
- **Dependencies:** M1-T13, feature wiring complete
- **Acceptance criteria:** AC-M8.5.
- **How to verify:** CI.
- **Status:** TODO  
- **∥L**

### M7-T03 — Telemetry grep CI + README disclosures
- **Description:** Strengthen `check-no-network`; README: Ollama, hardware, network, no-telemetry, sync-carries-cache (F-28).
- **Files:** `scripts/check-no-network.mjs`, `README.md`, `src/ui/settings-tab.ts`
- **Dependencies:** M1-T01
- **Acceptance criteria:** AC-M8.3, M9.5 disclosures.
- **How to verify:** CI grep; README review.
- **Status:** TODO  
- **∥L**

### M7-T04 — Clear all Synapse data (S3)
- **Description:** Command with confirm; wipe dismissals, touch log, caches/flags/resurface; keep settings.
- **Files:** `src/state/store.ts`, `src/ui/commands.ts`, `src/ui/strings/en.ts`, `src/state/clear.test.ts`
- **Dependencies:** M1-T07, M5-T04, M6-T03
- **Acceptance criteria:** AC-M8.6 / F-31 scope.
- **How to verify:** Unit test + manual.
- **Status:** TODO

### M7-T05 — Multi-turn chat (S2)
- **Description:** Last 3 turns in plan context; each turn re-runs search; setting default off.
- **Files:** `src/agent/chat-session.ts`, `src/agent/pipeline.ts`, `src/config/settings.ts`, `src/agent/chat-session.test.ts`
- **Dependencies:** M3-T05
- **Acceptance criteria:** AC-M3.7.
- **How to verify:** Unit tests.
- **Status:** TODO

### M7-T06 — Unload leak test + copy-diagnostics
- **Description:** Listener count before/after unload; redacted diagnostics command.
- **Files:** `test/integration/unload.test.ts`, `src/ui/commands.ts`, `src/core/logger.ts`
- **Dependencies:** M1-T16, all views registered
- **Acceptance criteria:** AC-M9.7; diagnostics never include note text/prompts.
- **How to verify:** Integration test; manual inspect clipboard bundle.
- **Status:** TODO

**Milestone 7 exit:** Must+Should code complete; privacy ACs evidenced in CI.

---

## Milestone 8 — Eval, gates close-out, release

**Goal.** Fixture vault + harness; Gate A/B numbers committed; recommended list only for models that clear bars; release workflow; community-review checklist.

### Parallel groups (M8)

- **∥M:** M8-T01 · M8-T04 (fixture content vs harness code)
- **∥N:** M8-T06 · M8-T07

---

### M8-T01 — Fixture vault + ground truth
- **Description:** Seed contradictions (≥25), hard negatives, known-answer Qs (≥40), text/scanned PDFs, injection note; syntax subset doc (F-24, F-33).
- **Files:** `eval/fixtures/vault/**`, `eval/fixtures/ground-truth.json`, `eval/make-fixtures.mjs`, `eval/fixtures/README.md`
- **Dependencies:** none (can start day one; finalize sizes here)
- **Acceptance criteria:** AC-M9.1; addresses eval statistical meaning (F-24).
- **How to verify:** Script regenerates; counts meet minima.
- **Status:** TODO  
- **∥M**  
- **Risk:** Start draft fixtures during M2–M3; this task freezes them.

### M8-T02a — Eval Node adapters
- **Description:** Second port implementations for headless eval: `FsVault`, `FsMetadata`, `NodePdfjs`.
- **Files:** `eval/adapters/fs-vault.ts`, `eval/adapters/fs-metadata.ts`, `eval/adapters/node-pdfjs.ts`, `eval/adapters/index.ts`
- **Dependencies:** M8-T01, M1-T04, M4-T02 (pdf contract)
- **Acceptance criteria:** Adapters satisfy port contracts on fixture syntax subset (F-33).
- **How to verify:** Contract tests against Fake* twins.
- **Status:** TODO

### M8-T02 — Eval harness + metrics + gates
- **Description:** Run metrics; gate checks; write `recommended.generated.json`.
- **Files:** `eval/harness/run.ts`, `eval/harness/metrics.ts`, `eval/harness/gates.ts`, `eval/harness/report.ts`, `src/llm/recommended.generated.json`
- **Dependencies:** M8-T02a, feature modules, M1-T17
- **Acceptance criteria:** AC-M9.2–9.3; S4 list only if bars met; addresses R3.
- **How to verify:** Local run against real Ollama; CI may run mock-only subset.
- **Status:** TODO

### M8-T03 — Gate B/C close-out (transport defaults)
- **Description:** Confirm Node transport in real renderer; set `transport: auto` order; document degraded mode; Gate C contingency note.
- **Files:** `docs/gate-b.md`, `src/llm/client.ts`, `src/config/defaults.ts`, `README.md`
- **Dependencies:** M1-T09, M1-T16, M4-T01
- **Acceptance criteria:** DESIGN §13 Gate B transport + Gate C decision recorded; addresses R2.
- **How to verify:** Probe results + default config review.
- **Status:** TODO

### M8-T04 — MetadataPort contract: Fake vs Fs vs Obsidian notes
- **Description:** Shared contract suite to limit eval drift (F-33).
- **Files:** `test/contract/metadata.test.ts`, `eval/adapters/fs-metadata.ts`, `test/fakes/fake-metadata.ts`
- **Dependencies:** M2-T04, M8-T01
- **Acceptance criteria:** Same fixtures parse consistently on supported syntax subset.
- **How to verify:** Contract tests in CI.
- **Status:** TODO  
- **∥M**

### M8-T05 — Apply Gate A budgets + recommended models UI
- **Description:** Commit wall-clock/`MAX_FIRST_PASSES`/selector strategy; settings show recommended only from generated file.
- **Files:** `src/constants.ts`, `src/llm/models.ts`, `src/llm/recommended.generated.json`, `src/ui/settings-tab.ts`
- **Dependencies:** M8-T02, M1-T17
- **Acceptance criteria:** AC-M9.3 / S4; no hand-waved “recommended”.
- **How to verify:** Settings UI + file stamp date in README.
- **Status:** TODO

### M8-T06 — Release workflow + version hygiene
- **Description:** Tag → build artifacts; version sync `manifest.json`/`versions.json`; bundle-size report.
- **Files:** `.github/workflows/release.yml`, `scripts/release.mjs`, `package.json`, `manifest.json`
- **Dependencies:** M1-T02
- **Acceptance criteria:** AC-M9.5 artifact set only.
- **How to verify:** Dry-run release workflow.
- **Status:** TODO  
- **∥N**

### M8-T07 — Community review checklist + UI a11y pass
- **Description:** Obsidian guideline checklist; light/dark contrast; keyboard nav notes (OQ-14); `docs/ui-checklist.md`.
- **Files:** `docs/ui-checklist.md`, `docs/plugin-review-checklist.md`, `styles.css`
- **Dependencies:** all UI milestones
- **Acceptance criteria:** AC-M9.6; manual checklist signed off.
- **How to verify:** Walk checklist in Obsidian.
- **Status:** TODO  
- **∥N**

### M8-T08 — Release candidate freeze
- **Description:** Final README, license, minAppVersion matrix, contradiction precision report on fixture; cut v0.1.0 (or chosen).
- **Files:** `README.md`, `CHANGELOG.md`, `manifest.json`, `eval/reports/` (summary committed without huge binaries)
- **Dependencies:** M8-T02–T07, M7 complete
- **Acceptance criteria:** Published GitHub release installable; AC-M6.10 numbers reported; success definition in SPEC §1 met or gaps explicitly waived.
- **How to verify:** Install from release zip in clean vault; run health + one Q&A + one contradiction + resurface.
- **Status:** TODO

**Milestone 8 exit:** Community-plugin-ready release candidate.

---

## Cross-milestone parallel schedule (summary)

| After… | Independent tracks |
|--------|-------------------|
| M1-T02 | Lint/CI (T02b) ∥ check scripts (T02c) ∥ early fixture drafting (M8-T01 draft) |
| M1-T02b | Core (T03–T05) ∥ fakes (T08) once T04 exists |
| M1 Phase 0 freeze | T1 llm/jobs/transport ∥ T4 state/config ∥ T6 UI shells ∥ T5 fixtures |
| M2 tools API | Evidence/agent (M3) ∥ PDF probe (M4-T01) ∥ compare (M5-T01) once ModelPort stable |
| M5 compare done | Contradiction UI ∥ Resurface scoring (M6) in parallel |
| Features wired | Privacy integration tests (M7) ∥ Eval adapters/harness (M8) |

Do **not** parallelize tasks that share `src/main.ts`, `styles.css`, or the same module `index.ts` without splitting sessions — those are integration choke points (M1-T16, M2-T10, M3-T07, M5-T08, M6-T05).

---

## Definition of done (every task)

1. Acceptance criteria checked; **Status** flipped to `DONE`.
2. Tests required by DESIGN §9.4 for that module are green in CI.
3. No new imports of `obsidian` / Node outside `adapters/`.
4. No note text in logs; no vault writes except via `StoragePort`.
5. Plugin still **loads and deploys** after the task (smoke: build + enable).

---

---

## Milestone 9 — Phase B: Local Ollama (after feature-complete)

**Goal.** Only after Milestones 1–8 Phase A work is done: add `OllamaClient`, loopback default, health-check, Gate A on-device bake-off, and recommended local models. Do not start this milestone early.

### M9-T01 — Ollama client behind existing `ModelPort`
- **Description:** Implement Ollama HTTP client + NDJSON; switch settings `provider: ollama`; keep OpenRouter as optional.
- **Files:** `src/llm/ollama-client.ts`, `src/llm/request.ts`, `src/policy/endpoint.ts`, settings UI
- **Dependencies:** Milestone 8 exit
- **Acceptance criteria:** Health + constrained call on loopback; AI disables cleanly when Ollama is down; OpenRouter path still works.
- **How to verify:** Mock + real Ollama smoke.
- **Status:** TODO

### M9-T02 — Gate A local bake-off
- **Description:** Run DESIGN §13 Gate A on floor hardware; write `recommended.generated.json`.
- **Files:** `eval/`, `recommended.generated.json`, README
- **Dependencies:** M9-T01
- **Acceptance criteria:** At least one local model clears Phase B bars or hardware floor is revised with evidence.
- **How to verify:** Eval report checked in (no secrets / no vault notes).
- **Status:** TODO

---

## Out of plan (explicit)

Per SPEC §3 and DESIGN §11: mobile, OCR/scanned PDF recovery, embeddings/vector DB, note editing, LM Studio / raw llama.cpp, paid OpenRouter as default, FTS5/SQLite, Web Workers, chat persistence, i18n, battery-aware scheduling — not scheduled unless a later plan revision promotes them.

**Local Ollama / Gate A on-device bake-off** is scheduled only as **Milestone 9 (Phase B)** after feature-complete — not during M1–M8.

