# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (unblocked): **M1-T06** (config store) · **M1-T08 (∥B)** (fake ports) — T05 schemas done; T06 needs T03+T04; T08 needs T04.

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T05**: seven zod model-output schemas (`health`, `qa.plan`, `qa.select`, `qa.answer`, `claims.extract`, `compare.contradiction`, `compare.relevance`); subset-safe JSON Schema emitter (nullable objects as `type: ["object","null"]`); `scripts/check-schema-subset.mjs` + CI `check:schema`; unit tests for valid/invalid shapes and keyword allowlist.
- Verified local gate: typecheck → lint → boundaries → test → check:network → check:writes → check:schema → build.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.
- `npm run lint` targets `src` and `test` only (root/scripts `.mjs` excluded from type-checked ESLint).

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.
- M1-T04 adds a small `createObservable` + `TransportError` class beyond the DESIGN interface snippets so later stores/fakes have a usable pure primitive and `instanceof` mapping.
- Tightened `check-no-writes.mjs` vault patterns to `\bvault\.(modify|create|…)` so `Set.delete` / similar are not false positives.
- M1-T05 uses a hand-rolled subset emitter instead of Zod’s `toJSONSchema` so nullable objects never emit `anyOf` (Zod 4’s default for `.nullable()` on objects).

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
