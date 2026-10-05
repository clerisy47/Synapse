# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (both unblocked by M1-T02): **M1-T02b** (vitest/eslint/CI) ∥ **M1-T02c** (boundary/privacy check scripts).

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T02**: package/tsconfig/esbuild scaffold; stub `src/main.ts`; `styles.css`; `npm run build` → `main.js`.
- Earlier: Probed OpenRouter; rewrote Phase A/B docs; M1-T01 identity (`vault-synapse`) frozen.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
