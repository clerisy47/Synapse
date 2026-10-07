# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (unblocked): **M1-T09 (∥B)** (Node HTTP transport; needs T04+T08) · **M1-T11 (∥B)** (job queue; needs T04+T08) · **M1-T12 (∥C)** (policy stubs; needs T03+T06) — T08 fake ports done. M1-T13 still waits on adapters (T07 DONE).

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T08**: `test/fakes/` with `FakeClock`, `FakeTransport`, `MemoryStorage`, `ScriptedModel` (skeleton `ModelPort` until M1-T10), and `RingBufferLogger` (80-char field dump guard, shared child ring); barrel `index.ts` + vitest smoke covering each port.
- Verified local gate: typecheck → lint (`src` + `test`) → boundaries → network/writes → test → schema → build.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.
- `npm run lint` targets `src` only; run `npx eslint src test` until the script includes `test/`.

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.
- M1-T04 adds a small `createObservable` + `TransportError` class beyond the DESIGN interface snippets so later stores/fakes have a usable pure primitive and `instanceof` mapping.
- Tightened `check-no-writes.mjs` vault patterns to `\bvault\.(modify|create|…)` so `Set.delete` / similar are not false positives.
- M1-T05 uses a hand-rolled subset emitter instead of Zod’s `toJSONSchema` so nullable objects never emit `anyOf` (Zod 4’s default for `.nullable()` on objects).
- M1-T06 uses explicit clamp/fallback helpers rather than zod `.catch` so out-of-range ints clamp instead of resetting to defaults.
- Tightened `check-no-network.mjs` `requestUrl` pattern to `\brequestUrl\s*\(` so the §4.5 transport-mode enum string is not a false positive.
- M1-T07 injects optional `schedule` for debounce (defaults to `window` timers) so vitest can run without a DOM `window`; touch-log hygiene deferred until vault/policy exist.
- M1-T08 keeps temporary `ModelPort` / structured-request types in `scripted-model.ts` until the production client lands in M1-T10; ring-buffer logger is a fake (production `ConsoleSink` still later).

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
