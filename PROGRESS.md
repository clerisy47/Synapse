# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (unblocked): **M1-T04** · **M1-T05 (∥A)** — port interfaces, model-output schemas. **M1-T03** (core types, Result, errors, text helpers) done.

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T03**: `src/core/` (DESIGN §4.1 types, §5.3 errors, Result, `foldCase` + hash/token helpers), property test for length-preserving fold; dependency-cruiser tweak for intra-module imports and core `*.test.ts`.
- Verified full local gate: typecheck → lint → boundaries → test → check:network → check:writes → build.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.
- `npm run lint` targets `src` and `test` only (root/scripts `.mjs` excluded from type-checked ESLint).

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
