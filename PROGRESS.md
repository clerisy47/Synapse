# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (unblocked): **M1-T08 (∥B)** (fake ports; needs T04) · **M1-T12 (∥C)** (policy stubs; needs T03+T06) — T07 state store done. M1-T13 still waits on T07 (now DONE) + adapters.

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T07**: `src/state/` with tolerant `parsePersisted` (unknown keys preserved, never throws), pure `mergeState` LWW rules + property tests, `StateStore` with debounced save / flush / reloadAndMerge / clearAll (keeps settings); `STATE_SCHEMA_VERSION` + `STATE_WRITE_DEBOUNCE_MS` in constants; widened `state-deps` for constants. Store I/O tests use an inline StoragePort double + injectable debounce scheduler (full `MemoryStorage` remains M1-T08).
- Verified local gate: typecheck → lint → boundaries → network/writes → test → schema → build.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.
- `npm run lint` targets `src` and `test` only (root/scripts `.mjs` excluded from type-checked ESLint).

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.
- M1-T04 adds a small `createObservable` + `TransportError` class beyond the DESIGN interface snippets so later stores/fakes have a usable pure primitive and `instanceof` mapping.
- Tightened `check-no-writes.mjs` vault patterns to `\bvault\.(modify|create|…)` so `Set.delete` / similar are not false positives.
- M1-T05 uses a hand-rolled subset emitter instead of Zod’s `toJSONSchema` so nullable objects never emit `anyOf` (Zod 4’s default for `.nullable()` on objects).
- M1-T06 uses explicit clamp/fallback helpers rather than zod `.catch` so out-of-range ints clamp instead of resetting to defaults.
- Tightened `check-no-network.mjs` `requestUrl` pattern to `\brequestUrl\s*\(` so the §4.5 transport-mode enum string is not a false positive.
- M1-T07 injects optional `schedule` for debounce (defaults to `window` timers) so vitest can run without a DOM `window`; touch-log hygiene deferred until vault/policy exist.

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
