# Local Bonsai setup and validation

The default is Bonsai 2 4B PQ2_0 using **PrismML llama.cpp**, tested on Apple Silicon with 8 GiB unified memory. This is a user-managed local server, not Ollama. Synapse never downloads weights or launches a server on plugin load. If unavailable, the plugin loads and inference reports a runtime error; it never silently calls OpenRouter.

## Install outside Synapse

The previous trial still exists at `/tmp/synapse-bonsai-trial`, but temporary storage can disappear. For a durable installation, clone the official demo outside your vault and repository:

```sh
git clone https://github.com/PrismML-Eng/Bonsai-demo.git "$HOME/Applications/Bonsai-demo"
cd "$HOME/Applications/Bonsai-demo"
git checkout db871ea96bffff5ce5609873c412b75d7cd5ba3c
./scripts/download_binaries.sh
python3 -m venv .venv
.venv/bin/python -m pip install huggingface_hub
HF_HUB_DISABLE_XET=1 BONSAI_FAMILY=bonsai2 BONSAI_MODEL=4B BONSAI_SKIP_MLX=1 ./scripts/download_models.sh
```

This pins the trial demo and Prism runtime `prism-b10777-e3de715`; inspect upstream scripts before executing. Download only the GGUF runtime/model path; Synapse does not need MLX, Open WebUI or a code interpreter. The download may also include a projector, unused by Synapse's text-only requests. PQ2_0 weights were 1,146,465,120 bytes; Q8 projector 366,894,624 bytes. Keep binaries, weights and download credentials outside this repository, vault and release artifacts.

Official references checked 2026-10-17: [backend support](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/BACKEND-SUPPORT.md), [small model API/sampling](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/SMALL-MODELS.md), [launcher](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/scripts/start_llama_server.sh). PQ2_0 requires Prism's fork. Do not substitute a generic llama.cpp build or Ollama. The small-model non-thinking API profile is explicit in the production builder: temperature 0.7, top-p 0.8, top-k 20, min-p 0, presence penalty 1.5, repeat penalty 1, window 64, seed 42, `enable_thinking=false`.

## Start and stop

From the demo directory, run in a dedicated terminal:

```sh
BONSAI_FAMILY=bonsai2 BONSAI_MODEL=4B BONSAI_CTX=4096 BONSAI_THINKING=0 BONSAI_HOST=127.0.0.1 PORT=18080 ./scripts/start_llama_server.sh -np 1 --alias bonsai-2-4b
```

Wait until the model is ready, then enable Synapse and run its health check. Stop with **Ctrl+C in that terminal** after jobs finish or are cancelled. Restart with the same command. Never bind the inference server to LAN/public interfaces. Local OS processes can reach an unauthenticated loopback server; treat the local machine as trusted.

Synapse settings: provider **Bonsai**, endpoint `http://127.0.0.1:18080/v1`, model `bonsai-2-4b`, context 4096. Bonsai always uses the abortable Node transport. Only numeric IPv4 loopback and fixed inference/health paths are accepted; hostname aliases, credentials, query parameters, fragments and remote endpoints are rejected. HTTP redirects are not followed. No API key is sent to Bonsai.

The server selects the weights at startup. The model setting is a served alias, not a download instruction: use `--alias` to match it. Other model sizes/contexts need independent memory and workflow validation; 27B is upstream's default, **not Synapse's recommendation for this 8 GiB Mac**. Changing Synapse's context setting does not resize the server. Every Bonsai output is capped at 1,024 tokens (or a smaller caller limit), including planning. Long prompts/research may exceed 4,096 context; shorten selected material rather than assuming larger context is evaluated.

## Settings migration and policy

Legacy default OpenRouter configurations migrate to Bonsai without changing exclusions, control paths, chat settings or stored credentials. Custom cloud configurations remain selected. Normalized settings contain `providerRevision: 1`, so subsequent explicit OpenRouter selection persists. Selecting a provider resets its endpoint/model to its defaults. OpenRouter is still a remote option with its existing disclosure and model-content policy; errors never switch providers.

For conservative compatibility, Bonsai retains existing internal plus `remote-model` content grants and masking. That policy field is an additional model-context restriction even though Bonsai has no remote egress. A starter policy denying `remote-model` still prevents note evidence from reaching Bonsai. Edit policy yourself to grant intended model access; Synapse never rewrites it or interprets a model output as permission. External MCP permissions and exact-diff local approval remain separate and unchanged.

## Troubleshooting

- **Offline/refused:** start the server, check port/alias and run health again. Missing runtime does not prevent plugin loading. There is no cloud fallback.
- **Loading/HTTP 503:** wait for model initialization; inspect the server terminal locally. No raw server diagnostics, prompts or note content should be copied into Synapse logs.
- **Missing model/HTTP 404:** verify weights and matching alias, and use `/v1` in the endpoint. The plugin does not download a missing model.
- **Schema/format error:** use the tested Prism version, non-thinking mode and full sampling profile. Grammar decoding is followed by runtime Zod validation; invalid JSON is never accepted as an answer/proposal.
- **Timeout/memory/context:** stop other memory-heavy work, shorten input and keep one slot/4096 context. This configuration is a measured starting point, not a hardware floor or reliability guarantee.
- **Stalled Hugging Face/Xet download:** the trial completed with `HF_HUB_DISABLE_XET=1`; retry the external download explicitly. No credentials belong in this repository.
- **Evidence unavailable:** inspect your Security.md grants and exclusions. Local inference does not bypass policy or missing/invalid controls.

## Repeat synthetic verification

With the server running:

```sh
node scripts/check-bonsai.mjs
SYNAPSE_LIVE_BONSAI=1 npm run test:live:bonsai
SYNAPSE_LIVE_BONSAI_QUALITY=1 npm run test:live:bonsai:quality
```

The first command exercises six synthetic cases through production BonsaiClient, Node transport, endpoint policy, Zod and JobQueue. The second runs production Q&A retrieval/citation and research proposal workflows with synthetic fake-vault fixtures. The third evaluates all 40 known-answer fixtures sequentially and reports correctness, current citations and latency. The two npm live test commands require their explicit environment opt-ins. No real vault inputs are read. `scripts/try-bonsai.mjs` remains the original isolated trial for comparison. See [integration results](bonsai-integration.md) and [quality revalidation](r5-t03-evaluation.md) for outcomes and limitations. These checks do not establish real Obsidian host behavior or full release quality.
