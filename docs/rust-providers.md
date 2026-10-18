# Rust provider foundation

RUST-T03 adds library capabilities. It does not expose a remote CLI switch or claim live model quality. The CLI still has the foundation help/version/root interface; terminal integration follows in RUST-T04. No runtime is started, downloaded or substituted.

## Contracts and authority

`ModelRequest` is a closed application-owned task, initially synthetic health. It carries a validated `Provider`; the default explicit constructor is `Provider::bonsai()`. The remote constructor requires a session `RemoteConsent` capability created by trusted local composition after disclosure. That composition must explain that questions, permitted passages, instructions, research and bounded history go to OpenRouter and its routed provider. Neither consent nor requests deserialize from model output or stored configuration. There is no remote CLI configuration or consent UI yet. The transport receives a credential from trusted composition; it has no credential discovery or note access. It never attaches that credential to Bonsai. Future task types must add bounded typed outputs and trusted evidence IDs rather than accepting arbitrary JSON schemas or model-selected destinations.

Health expects exactly one closed object, `{"status":"ok"}`. Extra/duplicate keys, prose/fences, tool calls, refusals, nonempty reasoning, extra choices, truncation and malformed responses are refused. The provider envelope may contain service metadata, but only the closed validated health value leaves the adapter. All failures map to fixed `ModelError` codes without raw error bodies, prompts, paths or credentials.

Provider-specific builders implement llama.cpp's `response_format: {type: "json_object", schema: ...}` and OpenRouter's named strict `json_schema` wrapper with `require_parameters: true` and `allow_fallbacks: false`. Bonsai also receives `chat_template_kwargs.enable_thinking: false`, temperature zero and no streaming. The user-managed server must have Bonsai 2 9B PQ2_0, 4,096 context and one slot configured; a health response alone does not attest the loaded weights, build or server settings. The local model alias is `bonsai`.

Primary protocol references: [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and the pinned [ureq configuration](https://docs.rs/ureq/3.1.2/ureq/config/struct.ConfigBuilder.html). Compatibility with a particular PrismML build remains an opt-in live check.

## Network, budget and cancellation

Only `http://127.0.0.1:18080/v1/chat/completions` and `https://openrouter.ai/api/v1/chat/completions` are production destinations. There is no public endpoint override. Proxies, redirects and gzip are disabled. TLS uses rustls/ring and bundled webpki roots; no native TLS library, shell tool, URL fetcher or custom trust bypass is installed. Remote requests require a separately selected validated model and credential; failures never retry against another provider.

Named bounds: 4,096 context tokens; 128 output tokens; 1,024 token template reserve; serialized request bytes conservatively counted as tokens; 16,384 response bytes; 2 second connect timeout; 30 second whole HTTP deadline. Oversize input/output is refused rather than truncated. This bound is deliberately conservative for byte-level tokenization and the initial tiny health schema; new task templates must revisit the template reserve with their tokenizer evidence.

All application model work enters `JobQueue`, including health. It admits at most eight waiting jobs, runs one job at a time, waits at most 30 seconds for admission and polls cancellation every 20 ms. It prioritizes interactive jobs in bursts of at most three while background work is waiting. Within each priority, order is FIFO. Failures release the lane with an RAII guard. Cancellation before dispatch prevents transport use; cancellation during a blocking HTTP call suppresses its result. Such a call retains its lane and lease until completion or the HTTP deadline (up to 30 seconds); no detached request can outlive its guard. Terminal signal handling and immediate socket-abort UX are not implemented here. Queue, lease and HTTP waits each have their own bounds, so a job may take up to approximately 90 seconds across all three phases.

## Cross-process lease

`LocalModelLease` uses an exclusive OS `flock` on `bonsai-127-0-0-1-18080.lock` in the existing private global application state directory, shared by all workspaces. Callers must supply that same OS state root for all processes. A workspace-specific lease would not protect the shared runtime. The adapter does not provision a state directory or import legacy state. It rejects workspace/state overlap, noncanonical/symlinked selected state paths and group/world-accessible directories. Every state-directory component opens with no-follow, anchored from the filesystem root. Each acquisition revalidates the directory identity and the acquired lock identity. The anchored directory descriptor opens only the fixed lock basename with no-follow, restrictive creation permissions and no truncation. Nonregular, multiply linked or broadly accessible lock files are refused. No content is written to the file and it is never removed by the product.

Each acquisition opens an independent descriptor, so separate threads/queues cannot share one flock accidentally. Contention polls cancellation every 20 ms with a 30 second deadline. Descriptor close releases the lock, including OS process death. No persisted approval or lock-file contents act as authority. This coordinates cooperating invocations using the same state root, not separately launched llama.cpp clients or users choosing inconsistent state directories. The runtime must stop abandoned generations on disconnect; timeout does not prove server-side cancellation. Live slot behavior remains a runtime validation item.

## Dependency review and checks

`ureq` 3.1.2 is pinned with default features disabled and only rustls enabled; `serde_json` 1.0.145 is pinned without custom schema engines. The exact resolved graph, features, licenses and build-script flags are frozen in `scripts/rust-dependencies.json` and Cargo.lock. New normal dependencies remain in adapters; core and application gain no network, filesystem, JSON or terminal libraries. Workspace unsafe code remains forbidden. Transitive TLS/syscall crates contain their own unsafe code.

New build scripts include ring (C/assembly compiled through cc, requiring a C toolchain at build time), rustls/httparse/serde_json compiler/configuration detection, and target-specific Windows link selection in the metadata graph. No model weights, network downloads or product runtime shell are added by these scripts. Most new licenses offer MIT/Apache-2.0; ring requires Apache-2.0 AND ISC, with transitive notices retained for release license work in RUST-T09. End users run a native binary without Cargo, Node.js or a C compiler. A changed dependency/feature/build-script inventory fails the boundary check for explicit review.

Synthetic tests cover closed schemas, separate builders, local credential omission, redirects, HTTP failures, oversized/malformed/truncated output, deadline/offline errors, queue serialization/cancellation/admission, private state and lock symlinks, cross-process contention and crash release. Architecture guards retain mutation probes and introduce only a lease-specific CREATE/RDWR exception; corpus adapters stay read-only. They enforce the two production URLs and required transport guards. These lexical checks supplement the compiler/tests and are not a Rust parser or a complete capability proof.

Opt-in synthetic live health (never run by default):

```sh
SYNAPSE_LIVE_STATE_ROOT=/absolute/private/global/state SYNAPSE_LIVE_BONSAI=1 cargo test --locked -p synapse-adapters --test model live_bonsai_health -- --ignored --exact
```

This sends only the constant health prompt to the already running numeric-loopback server. It uses the existing configured global private state directory for the same production lease and creates a synthetic empty workspace in a temporary directory. Set SYNAPSE_LIVE_STATE_ROOT to that canonical directory; do not substitute a workspace-specific lock directory. Do not infer model quality, terminal readiness, native MCP compatibility or release qualification from this test.
