# Bonsai runtime contract

The terminal platform defaults to Bonsai 2 9B PQ2_0 served by user-managed PrismML llama.cpp. Target endpoint: HTTP `127.0.0.1:18080`; context 4,096; one slot; thinking disabled. Numeric loopback only. Ollama is not a runtime substitute.

Runtime binaries and model weights stay outside this repository and application packages. Synapse must not download weights, launch a model server or silently select a remote provider. Install/start commands depend on the user's pinned PrismML build and weights; verify them against that build's documentation during implementation rather than copying obsolete host setup commands.

The CLI health flow is proposed as `synapse doctor --workspace <directory>` and is not implemented yet. It should distinguish unreachable runtime, incompatible structured-output support, context overflow, timeout and malformed output without printing raw provider bodies or prompts. An unavailable runtime must not prevent help, local indexing or deterministic diagnostics.

All requests use structured schemas, context validation, cancellation, one JobQueue and cross-process single-slot coordination. OpenRouter remains separately configured and explicitly consented; a local error never triggers fallback. Do not reuse an OpenRouter key for MCP or store it in notes.

CLI release evidence must record the exact runtime build/model identity, configured context/slot/thinking behavior, health, supported/unsupported cited answers, research proposal quality, timings and failures using synthetic data. No new runtime test was run during the documentation pivot; previous application-host checks do not close CLI gates.
