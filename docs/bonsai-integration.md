# Bonsai integration evidence — 2026-10-17

User-authorized provider scope revision: local Bonsai replaces the OpenRouter default now, using PrismML llama.cpp directly. This report covers integration work, not completion of the existing feature, quality, release or real-host gates.

## Configuration and implementation

Apple Silicon Mac, 8 GiB unified memory. Existing runtime and weights were present at `/tmp/synapse-bonsai-trial`. Used Prism llama.cpp `prism-b10777-e3de715`, Bonsai 2 4B PQ2_0, one slot, 4,096 context, thinking disabled, `127.0.0.1:18080`, alias `bonsai-2-4b`. No runtime or weights added to Synapse. Server was explicitly started for verification and stopped afterward.

Production BonsaiClient implements ModelPort with shared runtime Zod validation, freshness checks, bounded structured schema decoding, cancellation and one schema retry. A single Bonsai request builder sets Prism's small-model sampling profile and seed 42; output is capped at 1,024 tokens or the caller's smaller limit. The existing allowlisted Node transport enforces a Bonsai-specific numeric-loopback endpoint policy and does not follow redirects. Cloud keys are not resolved or sent for Bonsai. Model work in production workflows and live scripts enters JobQueue.

Settings default to Bonsai. Legacy default cloud settings migrate without mutating input or losing exclusions/unrelated settings. A persisted provider revision preserves subsequent explicit cloud selection; custom cloud configurations remain selected. Provider selection resets endpoint/model defaults. Missing runtime causes actionable errors in health/chat, without blocking plugin loading or falling back to cloud. Binaries/download/server lifecycle remain user-managed.

Policy, masking, exclusion, plugin-issued evidence/destination IDs, untrusted Markdown, exact-diff approval and restricted write mechanisms remain enforced. Local inference conservatively retains `remote-model` grants/masking as an additional content restriction; this change grants no extra vault access. See [setup and policy behavior](bonsai.md).

## Automated verification

- `npm test`: **923 passed, 5 opt-in live tests skipped** (928 total). Includes provider/request/schema retry, negative health, loading/missing/offline errors, settings migration/idempotence/explicit cloud selection, endpoint denial, cancellation/freshness, and existing policy/review/apply/MCP checks.
- New socket integration checks cancel a queued Bonsai request and observe the in-flight HTTP connection close, and verify a cloud redirect is not followed.
- Injected-host plugin tests verify loading and chat behavior with a deliberately offline runtime and missing/invalid/ready policy. These are **not real Obsidian tests**.
- Typecheck, lint (0 errors; 26 existing warnings), dependency boundaries (0 violations), network/write/schema checks (5 schemas) and production build passed.
- The existing 40-question scripted evaluation ran within the full suite: 40 expected answers and 40 valid citations. Scripted HTTP establishes pipeline integrity, not Bonsai answer quality. Existing policy/write tests are deterministic; no full live adversarial or MCP evaluation is claimed.

## Live production integration

Synthetic inputs only; no user vault content. Commands: `node scripts/check-bonsai.mjs`, `SYNAPSE_LIVE_BONSAI=1 npm run test:live:bonsai`. Health was also run separately through its live test. Repeat commands and prerequisites are in [setup](bonsai.md).

| Check | Latest observed result | Elapsed |
| --- | --- | --- |
| Six production provider cases | All schema-valid and expected-result checks passed | 1.049, 5.658, 3.657, 5.286, 2.645, 4.867 seconds |
| Full queued health | Server + structured production call ready | 0.961 seconds |
| Q&A workflow | Correct synthetic location; current plugin-owned citation verified; 3 model calls | 9.576 seconds |
| Research workflow | Correct research fact, issued destination/evidence IDs and deterministic daily path; no note written | 5.090 seconds |

These checks use production BonsaiClient, builder, Node transport and endpoint policy. Q&A includes production corpus/retrieval/tools/ledger/citation verification; research includes production capture, proposal generation and deterministic validation/routing. Workflow vaults are synthetic in-memory fixtures. No UI navigation, local approval, write/apply or native MCP client was exercised live with Bonsai; their existing deterministic coverage remains passing.

## Failures and limitations

The first six-case production pass had valid schemas throughout but failed one exact answer expectation (5/6 correct); it overlapped other live work on the one-slot server. The later seeded pass was 6/6. No causal explanation or reliability claim follows from that comparison.

An earlier research live run passed, but the subsequent fixed-seed run produced a structurally valid proposal that copied the style instruction instead of the research fact. The live fact assertion correctly failed. The production research prompt now explicitly requires summarizing `research.text` and treating `style` only as formatting. The unchanged assertion then passed. This illustrates why schema validity and valid IDs alone cannot establish content correctness; local diff review remains mandatory.

The first concurrent Q&A/research runs took 29.353/16.737 seconds; another sequential Q&A passed in 11.152 seconds. Final successful workflow timings above are single measurements, not percentiles or a benchmark. Seeded sampling does not guarantee deterministic output across runtime builds or hardware.

No full 40-question live Bonsai quality evaluation, long-context reliability, hardware-floor evaluation, real Obsidian load/unload/navigation/diff/apply, or native MCP workflow verification was performed. The 4,096 context/1,024 output bounds can constrain larger questions and research batches. Health verifies reachability and structured inference, not a cryptographic attestation of runtime version or selected weights. R5-T03, R5-T04 and R6-T02 remain open.

## Subsequent delivery revalidation

The later [R5-T03 report](r5-t03-evaluation.md) records the complete 40-question live evaluation, including initial 11/40 and 15/40 failures and the final 40/40 expected answers with current citations after planned-keyword normalization. Final median/p95: 12.363/14.232 seconds. The integrated automated suite has 926 passing tests. The operator confirmed Obsidian 1.14.4 host tests and explicitly excluded authenticated MCP workflows; native-client verification remains pending. These later results supersede the missing-40-question and unavailable-host limitations of the initial integration measurement above, without closing the feature or release gates.
