# PROGRESS.md — Synapse

## Current focus

R5-T03 synthetic evaluation is underway; see [Phase A gate evidence](docs/r5-t03-evaluation.md). The deterministic suite passes. Live `openrouter/free` failed structured output validation; real Obsidian/native-client smoke and live quality evaluation remain pending. The Phase A gate is open.
Provider stance: **Phase A = OpenRouter `openrouter/free`** through revised Must + Should completion; **Phase B = local Ollama**, after validation.

## Last session

- Third recorded live probe failed `FORMAT_IGNORED` after 1.55 seconds; stop further attempts under the three-failure rule. All 893 automated tests and required static/build checks passed again. PR #126 stays draft; provider investigation and real Obsidian/native-client evidence are required to proceed.

- Delivery revalidation: 893 tests and all required static/build checks passed; the separate live `openrouter/free` probe again failed `FORMAT_IGNORED` (1.15 seconds). PR #126 remains a draft pending live-provider and real-host evidence.

- Added 40 synthetic known-answer cases through queued production retrieval, tools, OpenRouter HTTP parsing, and current-passage citation verification. Scripted answers measure pipeline integrity, not live model quality.
- Added `npm run test:eval` (204 checks) and `npm run test:live` entry points. Full suite: 893 passed, one opt-in live test skipped; required static checks and build passed.
- Separately loaded the local key without logging it and ran the real `openrouter/free` health-shaped call: failed `FORMAT_IGNORED` after 3.65 seconds. No alternate model used.
- Real Obsidian host/client evidence is pending; no desktop-control tool is available in this session. Existing injected-host tests are not presented as real host smoke.
- R5-T03 remains IN_PROGRESS; R5-T04 and Phase B remain gated. Evaluation changes are prepared for review without declaring feature completion.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- Use `openrouter/free` for all live tests and the default model (user decision 2026-10-13). The retired Qwen default returned HTTP 404; the `openrouter/free` live health probe failed with `FORMAT_IGNORED` on 2026-10-13. Automated checks pass (398 tests); no alternate live model will be used.
- `npm run lint` targets `src` only. Supplemental `npx eslint src test` currently fails on pre-existing `@typescript-eslint/no-this-alias` at `test/fakes/fake-corpus.ts:210`; M3-T06 does not change that fake.
- ESLint warns that `PluginSettingTab` lacks `getSettingDefinitions()` (Obsidian 1.13+ settings search); declarative settings deferred.

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.
- M1-T04 adds a small `createObservable` + `TransportError` class beyond the DESIGN interface snippets so later stores/fakes have a usable pure primitive and `instanceof` mapping.
- Tightened `check-no-writes.mjs` vault patterns to `\bvault\.(modify|create|…)` so `Set.delete` / similar are not false positives.
- M1-T05 uses a hand-rolled subset emitter instead of Zod’s `toJSONSchema` so nullable objects never emit `anyOf` (Zod 4’s default for `.nullable()` on objects).
- M1-T06 uses explicit clamp/fallback helpers rather than zod `.catch` so out-of-range ints clamp instead of resetting to defaults.
- Tightened `check-no-network.mjs` `requestUrl` pattern to `\brequestUrl\s*\(` so the §4.5 transport-mode enum string is not a false positive.
- M1-T07 injects optional `schedule` for debounce (defaults to `window` timers) so vitest can run without a DOM `window`.
- M1-T08 kept temporary `ModelPort` types in `scripted-model.ts` until M1-T10; ring-buffer logger is a fake (production `ConsoleSink` still later).
- M1-T09 injects optional `checkEndpoint` instead of importing `policy` (adapters may only depend on `core`); EndpointPolicy wiring lands with M1-T12 / composition root. Disabled Obsidian window-timer lint rules for `adapters/node` and `test/` because Node timers are correct there.
- M1-T10: optional `headers` on `Transport`; `llm-deps` may import `src/constants.ts` (same as config/state) for timeouts / `NUM_PREDICT` / `PLUGIN_NAME`. Auth/rate-limit map to `MODEL_HTTP_ERROR` + remediation keys (no new `ErrorCode`s).
- M1-T11: `createJobQueue({ clock, abortable })` injects abortability (composition root will pass `transport.capabilities.abortable`); `progress()` stores last stage only (status-bar UI is M1-T14).
- M1-T13: `createObsidianStorage` takes injectable deps for CI; `createObsidianStorageFromPlugin` wraps live Plugin. `RequestUrlTransport` injects `requestUrl` for tests and lazy-imports Obsidian otherwise; local `EndpointChecker` type (adapters must not import each other). `onLayoutReady` disposable only suppresses late callbacks (Obsidian API has no unsubscribe). Vitest aliases `obsidian` → `test/stubs/obsidian.ts`.
- M1-T14: notice Retry is an injected `onRetry` callback; mount tests use a minimal `HTMLElement` fake (vitest `environment: node`).
- M1-T15: settings panel uses injectable `SettingsTabHost` (no `obsidian` in `ui/`). Avoided `requestUrl (` in UI strings so `check-no-network` `\brequestUrl\s*\(` stays green.
- M1-T16: `PluginSettingTab` lives in adapters with injected `mount` callback (adapters-deps forbid importing ui). HealthChecker rebuilt on settings invalidate rather than adding a reset API. System `Clock` inlined in `main.ts`. `minAppVersion` 1.8.7 for `Notice.messageEl`.
- M1-T18: checklist marks automated CI/build rows done; Obsidian UI rows left for optional clean-vault operator pass (PLAN allows).
- M2-T02: inject `sliceMs` into `createCorpusStore` (corpus must not import `constants.ts` per dependency-cruiser).
- M2-T03: `bytesCached` is folded-length sum only; cache cap remains provisional. Indexes are maintained by CorpusStore.
- M2-T04: `store.test.ts` keeps local TestMetadata stub for older cases; unique targets only (`count > 0` gates edges).
- M2-T05: combined NoteDate tests to stay in file budget; title search trims query; date-only ISO uses UTC midnight.
- M2-T06: tool arg/result caps live as named constants in `args.ts` (tools-deps forbids `constants.ts`); duplicate checks stay outside `invoke` via `createDuplicateTracker`; registry `canonicalKey` returns `null` on invalid args.
- M2-T07: tool bodies take `CoreToolDeps` (duck-typed); `sliceMs`/`budgetMs`/excerpt expand live in tools (not `constants.ts`); filename match for `search_by_title` is tool-layer only; FakeCorpus omits excluded notes so missing≡excluded.
- M2-T08: `unresolvedCount` lives on `CoreToolDeps` / CorpusStore rather than extending LinkGraph.
- M2-T09: touch/FM on `CoreToolDeps`; live wiring via CorpusStore + session/`touchLog` in composition (M2-T10).
- M2-T10: adapters use injectable surfaces + `FromApp` factories; status bar duck-types `IndexBarStatus` (ui must not import corpus); stable `indexStatus` forwarder survives corpus rebuild; debug command is path-only Notice (no note body).
- M3-T01: `segment` is async (needs `sha1Hex`) and takes `ref`/`sourceMtime` so it can return full `Excerpt[]`; evidence mirrors 200/600/300 locally (cannot import `constants.ts`); citation title in `renderForPrompt` is path basename until DocMeta is threaded later.
- M3-T02: `resolveAnchor` returns DESIGN `null` (not PLAN “undefined”); `hintStart` only disambiguates duplicate exact quotes (no wrong-text hint fallback).
- M3-T03: RunBudget defaults/fractions live in `budget.ts` (agent-deps forbids `constants.ts`); SPEC evaluate/stop mapped to ANSWER/VERIFY/DONE; cancel stays outside the machine.
- M3-T04: TopK sets `enough: true` (skip READ → two-call Gate A path); `QA_NUM_PREDICT` mirrored in `prompts.ts`; machine `modelCalls` accounting for top-k left to M3-T05.
- M3-T06: UI uses structural Q&A input types to preserve the current ui-deps allowlist; ItemView lives in adapters and receives mount/type/title via injection. Registration and real pane smoke await M3-T07; navigation awaits M3-T08. DOM tests use happy-dom without changing the default Node test environment.
- M3-T05: public `ChatTurn` is `{question,answer}`; mapped to prompt `{role,text}` in `chat-session`; `QaIndexStatus` duck-typed (agent-deps forbids corpus); `enough` → empty machine `readIds` to skip READ; stats.modelCalls count actual generates (TopK select has no usage).

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
