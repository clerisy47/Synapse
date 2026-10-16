# R5-T03 Phase A evaluation evidence

Measured 2026-10-16. The Phase A feature-complete gate remains open.

## Reproduce

- `npm run test:eval`: deterministic synthetic integration evaluation.
- `npm test`: full automated suite, including schemas, cancellation, queue,
  recovery, diagnostics and all tool contracts.
- `npm run test:live`: health-shaped structured request using the production
  OpenRouter client; requires `OPENROUTER_API_KEY` in the environment.
  With a local `.env`, use
  `node --env-file=.env node_modules/vitest/vitest.mjs run test/live/openrouter.live.test.ts`.
  Never capture keys or provider response bodies in the report.
- Run typecheck, lint, boundaries, check:network, check:writes, check:schema,
  and build using the package scripts.

## Results

| Measurement | Result | Interpretation |
|---|---|---|
| Known-answer questions | 40/40 correct | Scripted HTTP responses, not live reasoning accuracy |
| Current evidence citations | 40/40 valid (100%) | Each references the expected note and a current passage containing the expected fact |
| Model response schema parsing | 120/120 accepted | Three production-client structured responses per known-answer question |
| Excluded sentinel/path disclosures | 0 in checked requests, results and events | Asserted for every case; not a claim about every possible input |
| Original fixture note changes | 0 | Both allowed and excluded source text remain unchanged |
| Known-answer case elapsed time | 2–9 ms | Local mock HTTP, including setup; not provider latency |
| Selected integration suite | 204 passed / 11 files | `npm run test:eval` |
| Full suite | 893 passed, 1 opt-in live test skipped | `npm test`, live test run separately below |
| Static checks and build | Passed | Lint: 26 warnings, zero errors |
| Live openrouter/free structured probe | Failed: FORMAT_IGNORED | 3.65 seconds; invalid output refused, no fallback |

The integration test prints aggregate counts and individual case elapsed times.
It does not print questions, note bodies, paths or keys. Expected facts are stored
in the synthetic test table. Scripted replies deliberately match these facts;
this verifies transport, retrieval and evidence plumbing, not model comprehension.
The known-answer fixture currently uses text search/read; other tool behavior is
covered by tool contracts and recipient integration tests rather than all 40 cases.

## Coverage map

| Requirement | Executable evidence |
|---|---|
| F1 runtime/schema/queue | Full suite: llm client/health/schema and jobs tests; pipeline HTTP integration |
| F2/F3 iterative search/citations | pipeline-e2e: second-search and phrase-only fixtures, graph follow-up, zero-read budget, forged IDs, vanished passages, insufficient evidence |
| F4 controls and routing | control-ingest, research-review and full controls/proposal tests: control edits, daily routing, ambiguity |
| F5/F11 research/apply/recovery | research-inbox, research-review, research-plugin, mini-vault plus full recovery tests: duplicate/edited batches, stale approvals, partial writes, restart and fresh revert approval |
| F6 policy/injection | recipient-pipeline, recipient-tools, control-ingest: current access, masks/denials, prompt/history projection; research/MCP injection coverage |
| F7 authenticated MCP | mcp-server and mcp-semantics: scoped query/submission, revocation, deny/mask, duplicate submission and reconciliation |
| F8/F10 privacy/clear | Full privacy/state/UI/composition tests and static network/write/schema checks |
| F9 chat | chat-plugin and full chat-session tests: multi-turn retrieval and current-policy history |

Passing these tests means their assertions hold. It does not independently
measure a universal disclosure/write rate or substitute for desktop workflow QA.

## Remaining gate evidence

1. Live health and real Q&A/research quality must pass with `openrouter/free`.
   The first live structured call failed. No 40-question live quality result,
   provider latency distribution, or real-model citation rate is claimed.
2. Real Obsidian load/unload, exact citation selection, diff review, apply,
   unsaved/stale conflicts, restart/revert, clear-data, and authenticated native
   MCP-client smoke must be recorded with numeric host/client versions.
   Obsidian is installed, but this session has no desktop-control tool. Existing
   injected-host and disk-backed mini-vault checks do not close these manual gaps.
3. Use the synthetic files in `test/mini-vault` and the existing
   [review smoke](r3-t03-review-smoke.md) and [apply smoke](r3-t04-apply-smoke.md)
   checklists. Record pass/fail per workflow without credentials or vault content.

R5-T03 stays IN_PROGRESS. R5-T04 and Phase B cannot start from these results.
