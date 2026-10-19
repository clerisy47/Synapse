# Synapse

Native Rust terminal application for Markdown workspace questions, reviewed note updates and scoped MCP collaboration. See [PLAN.md](PLAN.md) for task status and [SPEC.md](SPEC.md) for the complete target contract.

Interactive chat and one-shot questions retrieve permitted body passages through local Bonsai, with verified current file/line sources and explicit insufficient-evidence results. The interface currently answers with selected passages. Research capture, metadata repair, exact local review/Apply, recovery and authenticated loopback MCP are implemented. Historical TypeScript/npm files are outside the native build.

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
synapse research review --workspace /path/to/notes --capture 1
synapse recovery --workspace /path/to/notes
synapse mcp grant --workspace /path/to/notes --query
synapse mcp serve --workspace /path/to/notes
```

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

See [CLI JSON contract](docs/contracts/cli-v1.md), [foundation decisions](docs/cli-scaffold.md), [provider limits](docs/rust-providers.md), [architecture](DESIGN.md), [progress evidence](PROGRESS.md) and [release validation](docs/release-validation.md). Development artifacts are not published. Platform qualification and remaining limitations are recorded in [native installation](docs/native-install.md).
