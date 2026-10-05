# PROGRESS.md — Synapse

## Current focus

Next PLAN tasks (unblocked after M1-T04): **M1-T05 (∥A)** · **M1-T06** (needs T04) · **M1-T08 (∥B)** — schemas, config store, fake ports.

Provider stance: **Phase A = OpenRouter free models**; **Phase B = Ollama only after feature-complete** (SPEC §0 / ADR-21).

## Last session

- Completed **M1-T04**: freeze `Clock` / `Logger` / `Observable` + I/O ports (`VaultPort`, `MetadataPort`, `StoragePort`, `PdfJsPort`, `NavigationPort`, `ActiveNotePort`, `Transport` + `TransportError`); pure `createObservable` helper; re-exported from `src/core/index.ts`.
- Verified local gate: typecheck → lint → boundaries → test → check:network → check:writes → build.

## Known issues

- `.env` previously had a trailing space in the key name and quoted value — normalized; keep `OPENROUTER_API_KEY=...` unquoted.
- `openrouter/free` can route to thinking-heavy models; prefer pinned `:free` IDs for schema work.
- `npm run lint` targets `src` and `test` only (root/scripts `.mjs` excluded from type-checked ESLint).

## Shortcuts taken

- DESIGN §5.6 / §8 / §11 and PLAN M1 tasks updated in place rather than a full line-by-line pass of every Ollama mention in DESIGN §6–§13 flows.
- M1-T04 adds a small `createObservable` + `TransportError` class beyond the DESIGN interface snippets so later stores/fakes have a usable pure primitive and `instanceof` mapping.
- Tightened `check-no-writes.mjs` vault patterns to `\bvault\.(modify|create|…)` so `Set.delete` / similar are not false positives.

## Decisions not in DESIGN.md

- None outstanding (ADR-21 landed in DESIGN).

## Rules to add to AGENTS.md

- (cleared — Phase A/B rules already in AGENTS.md)
