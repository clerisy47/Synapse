# Synapse

Native Rust terminal application for Markdown workspace questions, automatic note updates and scoped MCP collaboration.

Interactive chat and one-shot questions retrieve permitted body passages through local Bonsai, with verified current file/line sources and explicit insufficient-evidence results. The interface currently answers with selected passages. Research capture/apply, metadata repair, create/edit/delete/rename, recovery and authenticated loopback MCP are implemented. Local mutations auto-apply (use `--preview` to dry-run); high contradiction severity still writes and records a flag. MCP cannot apply destination-note changes. The application and CLI are implemented entirely in Rust; Python scripts support verification and packaging.

Rust 1.85.1 is pinned for builds. Installed binaries require neither Rust nor Node.js. The default user-managed PrismML llama.cpp runtime is Bonsai 2 9B PQ2_0 at `127.0.0.1:18080`, 4,096 context, one slot, thinking disabled. Synapse never starts or downloads it.

```sh
cargo build --locked --release
cargo install --locked --path crates/synapse-terminal
synapse --workspace /path/to/notes
synapse ask --workspace /path/to/notes "What do my notes say about this topic?" --json
synapse doctor --workspace /path/to/notes --offline
synapse setup --workspace /path/to/notes --preview
synapse metadata review --workspace /path/to/notes
synapse research capture --workspace /path/to/notes --file Research.md --lines 1:3
synapse research apply --workspace /path/to/notes --capture 1
synapse contradictions --workspace /path/to/notes --json
synapse recovery --workspace /path/to/notes
synapse mcp grant --workspace /path/to/notes --query
synapse mcp serve --workspace /path/to/notes
```

Persistent lexical indexing is enabled by default. A private external SQLite cache stores derived terms, source hashes, block ranges and discovery metadata, including WAL/SHM sidecars; it stores no source bodies or citation snippets. Each query completes a contained inventory and content-hash reconciliation, reparsing only changed eligible notes. Filesystem notifications are dirty hints. `synapse data clear` removes index state and revokes grants while preserving notes, configuration and unresolved recovery records.

Question answering uses bounded requirement planning, retained support assessments and final confirmation of the actual extractive output. Relevance alone is insufficient. Local context remains 4,096 tokens with one slot; explicitly selected OpenRouter uses a bounded 32,768-token application allowance. Both providers permit up to 32 inference calls within 240 seconds (MCP: 60 seconds).

Interactive commands: `/search terms`, `/source N`, `/reset`, `/help`, `/quit`. Ctrl-C cancels. Ordinary retrieval notes require description/tags/aliases metadata; instructions and the research inbox are excluded and are not required for chat. OpenRouter is available only with explicit selection/disclosure consent; see `synapse --help`.

```sh
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
python3 scripts/check-rust-boundaries.py
python3 scripts/test-rust-terminal.py target/release/synapse
# Opt-in synthetic live checks, using the already-running local runtime:
python3 scripts/test-rust-bonsai.py target/release/synapse
python3 scripts/test-rust-terminal.py target/release/synapse --live
python3 scripts/test-rust-review.py target/release/synapse --live
python3 scripts/evaluate-rust-quality.py target/release/synapse
cargo build --locked -p synapse-adapters --example mcp_client
python3 scripts/test-rust-mcp.py target/release/synapse target/debug/examples/mcp_client
```

See [CLI JSON contract](docs/contracts/cli-v1.md), [MCP contract](docs/contracts/mcp-v1.md) and [native installation](docs/native-install.md).

### DeepSeek through OpenRouter

Selecting `--provider openrouter` uses `deepseek/deepseek-v4.1-flash` unless
`--model <author/model>` overrides it. The default DeepSeek model uses the explicit DeepInfra route through OpenRouter, with fallback disabled. Bonsai remains the default provider.
Set `OPENROUTER_API_KEY` in your environment using your secret manager; do not
store credentials in the repository. Synapse does not load `.env` files.

Remote disclosure: permitted passages, questions, instructions, selected research,
and bounded conversation history may be sent to OpenRouter and its routed
provider. Use `--remote-consent` to accept this disclosure for an invocation.

```sh
synapse --workspace /path/to/notes --provider openrouter --remote-consent
synapse ask --workspace /path/to/notes "Your question" --provider openrouter --remote-consent --json
```

Strict schemas and provider budgets remain enforced: local context is 4,096,
remote context is bounded at 32,768, and both allow up to 32 calls. Remote
completion starts are paced within each process; there is no automatic retry or
provider fallback. Live DeepSeek schema compatibility and answer quality
require separate verification; configuring the model does not establish them.
