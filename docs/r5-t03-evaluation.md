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
- `SYNAPSE_LIVE_QA=1 node --env-file=.env node_modules/vitest/vitest.mjs run test/integration/pipeline-e2e.test.ts -t 'Phase A live Q&A smoke'`:
  opt-in single-question production pipeline smoke with synthetic notes. With the
  key already exported, use `SYNAPSE_LIVE_QA=1 npm run test:live:qa`.
  Both the key and explicit opt-in are required; ordinary CI does not send input.
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

## Delivery revalidation

Revalidated 2026-10-16: 893 automated tests passed (one opt-in live test
skipped); typecheck, lint (26 warnings, zero errors), boundaries, network,
write, schema and production build checks passed. The separate live
`openrouter/free` structured probe again failed with `FORMAT_IGNORED`
(1.15 seconds). No alternate model or relaxed parser was used.
PR #126 remains a draft because live-provider and real-host requirements
are still unmet; the passing CI suite does not close the Phase A gate.

A third recorded live probe on 2026-10-16 failed with `FORMAT_IGNORED`
after 1.55 seconds. Required static checks, all 893 automated tests (one
opt-in live test skipped), and the production build passed again. Further
attempts stop under the repository's three-failure rule. No desktop-control
tool is available for the outstanding real-host evidence. Next action:
investigate the provider's structured-output behavior in a separately scoped
follow-up and obtain real Obsidian/native-client workflow evidence before
closing the gate. Keep the strict parser and `openrouter/free` requirement.

## Provider budget investigation

On 2026-10-16, the active user-edited AGENTS.md superseded the earlier
three-attempt stop with ten attempts and a 30-second wait before retries.
Follow-up probes observed that wait and used only synthetic health input.

A metadata-only diagnostic with the original 16-token request returned HTTP
200, `finish_reason: length`, null answer content, and reasoning output. This
demonstrates budget exhaustion for that request, not proof that every earlier
FORMAT_IGNORED had the same cause. OpenRouter documents that reasoning and
visible output can share `max_tokens`:
[reasoning token budget](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Raised the provisional health budget in `src/constants.ts` from 16 to 512.
Two separate production-client live tests still failed FORMAT_IGNORED (2.48
and 5.97 seconds). A separate metadata-only diagnostic at 512 tokens returned
HTTP 200, `finish_reason: stop`, six completion tokens, and valid health JSON.
That isolated success is not a production health pass or a quality evaluation.
No response text, reasoning text or credentials were printed or retained.
The budget increase is a partial mitigation; router reliability remains unresolved.

After the budget change, typecheck, lint (26 warnings, zero errors), boundaries,
network/write/schema checks, all 893 automated tests (one live test skipped),
and production build passed. Real host/client evidence remains unavailable.
Keep the PR draft and R5-T03 IN_PROGRESS.

## Latest production health revalidation

On 2026-10-16, the production-client `openrouter/free` live health test passed
with the 512-token budget in 14.79 seconds. This is one successful structured
health request after the failures above; it does not establish reliability or
live Q&A/research quality. No provider response content or credentials were
printed. All 893 automated tests passed (one opt-in live test skipped in the
full run); typecheck, lint (26 warnings, zero errors), boundaries,
network/write/schema checks and production build passed.

Real Obsidian/native-client evidence is still unavailable in this session.
PR #126 remains draft and R5-T03 remains IN_PROGRESS. Live quality evaluation
and the manual workflows below are still required before merge or gate closure.

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
   The latest health call passed after earlier failures. No 40-question live quality result,
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

## Live Q&A smoke follow-up

On 2026-10-16, added a separately opt-in synthetic Q&A smoke using the same
queued production pipeline and tools as the deterministic HTTP evaluation.
It uses `openrouter/free`, checks the expected fact and a verified citation into
current evidence, and preserves both allowed and excluded fixture notes. It
reports aggregate booleans/timing or error codes without provider content or keys.
Live execution uses a progressing clock so production wall-clock budgets apply.

The first live attempt failed `FORMAT_IGNORED` after 2.26 seconds, before an
answer could be evaluated. No alternate model, parser relaxation or retry was
used. This establishes an executable live pipeline check but provides no passing
Q&A quality evidence. The 40-question live evaluation, research quality and real
Obsidian/native-client workflows remain outstanding. R5-T03 stays IN_PROGRESS
and PR #126 remains draft.

Validation: 893 automated tests passed, with two explicitly opt-in live tests
skipped. Typecheck, lint (26 warnings, zero errors), boundaries, network/write/
schema checks and production build passed. The final clock adjustment also
passed typecheck and all 48 deterministic pipeline tests.

## 2026-10-17 delivery follow-up

Continued the existing evaluation branch and draft PR #126, preserving the
user's uncommitted AGENTS.md change. A production `openrouter/free` Q&A smoke
failed FORMAT_IGNORED after 10.95 seconds, before answer evaluation.

Added metadata-only instrumentation to the explicitly opt-in live pipeline
transport. It reports fixed finish/content categories and validated numeric
completion/reasoning token counts. It does not output provider text, reasoning,
questions, paths, model identifiers or credentials. Four tests exercise missing
responses, hostile metadata/counts, empty content and JSON content. The smoke
also reports locally computed status and model/read/hop counts.

A subsequent attempt, after more than the required 30-second retry interval,
parsed two completions with finish `stop` and JSON content. Their completion /
reasoning token counts were 100 / 0 and 1467 / 1365. The smoke then failed both
the expected-answer and verified-citation checks after 46.43 seconds. The run
exceeded the default 45-second pipeline budget; this is a possible contributor,
not an established cause. The upstream token counts are observations, not proof
that requested token caps were honored. No provider output was retained or
parser/budget relaxed, and no alternate model was used.

Validation: 897 automated tests passed, two opt-in live tests skipped;
typecheck, lint (26 warnings, zero errors), boundaries, network/write/schema
checks and production build passed. All 40 scripted known-answer/citation
cases remain green. Real Obsidian/native-client evidence is still unavailable
through this session's tools and was requested from the operator. No live
quality pass is claimed. Keep R5-T03 IN_PROGRESS and PR #126 draft; do not
merge or begin the dependent milestones until the remaining gate evidence passes.
