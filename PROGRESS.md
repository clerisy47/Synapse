# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (both unblocked): **M1-T03** · **M1-T04** · **M1-T05 (∥A after T02b)** — core types, ports, model schemas.

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T02b** + **M1-T02c**: Vitest + smoke test, ESLint (obsidianmd + import bans), dependency-cruiser, `scripts/check-*`, GitHub CI workflow.
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
