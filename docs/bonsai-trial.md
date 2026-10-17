# Bonsai compatibility trial — 2026-10-17

User requested a Bonsai trial, overriding provider phasing for this isolated experiment. Production provider settings and Phase A completion claims are unchanged.

## Environment and method

- Apple Silicon arm64, 8 GiB unified memory.
- [Bonsai demo](https://github.com/PrismML-Eng/Bonsai-demo), commit `db871ea96bffff5ce5609873c412b75d7cd5ba3c`.
- Prism llama.cpp `prism-b10777-e3de715`, Bonsai 2 4B `PQ2_0` weights (1,146,465,120 bytes), Q8 projector (366,894,624 bytes).
- Loopback server, 4,096-token context, one slot, thinking disabled. Small-model non-thinking sampling profile; seed 42, output cap 1,024 tokens.
- Six fixed synthetic prompts, production Zod/JSON schemas, production JobQueue. Schema-constrained decoding plus explicit expected-result checks. No vault inputs or production provider integration.
- Script prints only case IDs, schema/correctness booleans, finish reason, token count and elapsed time.

## Results

| Case | Schema valid | Expected result | Seconds |
| --- | --- | --- | --- |
| Health | Yes | Pass | 1.416 |
| Search planning | Yes | Pass | 3.997 |
| Evidence selection | Yes | Pass | 1.773 |
| Answer with evidence ID | Yes | Pass | 4.585 |
| Insufficient evidence | Yes | Pass | 3.145 |
| Research proposal with destination/evidence IDs | Yes | Pass | 3.891 |

These are compatibility checks, not a quality benchmark or evidence that the full retrieval/review/MCP workflows pass. Citation IDs were checked against fixture expectations; production citation navigation was not exercised. No adversarial-policy or long-context evaluation was performed. One pass per case; no reliability claim.

Synapse checks: 898 automated tests passed, two existing opt-in live tests skipped; typecheck, lint (warnings only), boundaries, network/write/schema checks and build passed.

## Repeat

Trial checkout and weights are outside the repository at `/tmp/synapse-bonsai-trial` (temporary storage). Setup skipped MLX, Open WebUI and the code interpreter. Xet stalled; the HTTP retry completed with `HF_HUB_DISABLE_XET=1`.

Start from that checkout:

```sh
BONSAI_MODEL=4B BONSAI_CTX=4096 BONSAI_THINKING=0 BONSAI_HOST=127.0.0.1 PORT=18080 ./scripts/start_llama_server.sh -np 1
```

From Synapse:

```sh
node scripts/try-bonsai.mjs
```

The trial server was stopped afterward. Actual plugin use requires a reviewed loopback provider adapter, endpoint policy/settings/health integration, cancellation tests and full workflow evaluation. The default PQ2_0 packing needs Prism's runtime; do not assume the installed Ollama can load it. See the upstream [backend guide](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/BACKEND-SUPPORT.md).
Subsequent scope revision: production integration is now recorded separately in [Bonsai integration evidence](bonsai-integration.md). The trial results and limitations above remain historical evidence.
