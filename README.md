# Synapse

Synapse is a planned Rust terminal agent for a local Markdown workspace. It brings a Codex CLI-style conversation and review workflow to searching notes, answering with verified sources, and turning rough research into approved note changes.

No embeddings, vector database, or telemetry. Local Bonsai inference is the default; OpenRouter is an explicitly selected remote option.

## Project state

The native Rust foundation is implemented: `synapse --help`, `synapse --version`, and explicit canonical-root validation in a real terminal. Chat, search, providers, research, state persistence and MCP are pending. A valid interactive invocation displays the sanitized root and returns `NOT_IMPLEMENTED` (exit 1). Redirected interactive use is refused (exit 3). Historical TypeScript/host sources are retained outside the Cargo build and native artifacts.

Start with [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md). [PROGRESS.md](PROGRESS.md) records the current handoff. Old implementation results do not establish CLI readiness.

## Intended workflow

The following commands describe the proposed interface, not currently available commands:

```sh
synapse --workspace ~/Notes
synapse ask --workspace ~/Notes "What have I learned about decision trees?"
synapse research review --workspace ~/Notes
synapse doctor --workspace ~/Notes
```

The interactive terminal shows retrieval progress, answers with numbered sources and file/line locations, and reviewable diffs. Search and chat work without instruction files. Research uses configurable `Synapse/Instructions.md` and `Research.md`; existing files are never overwritten during setup. Changes need exact local review and explicit Apply. External MCP clients can query permitted notes or submit research with granted scopes; they cannot approve or apply changes.

## Runtime and privacy

Default model: Bonsai 2 9B PQ2_0 through user-managed PrismML llama.cpp at `127.0.0.1:18080`, 4,096 context, one slot, thinking disabled. Synapse will not download weights, launch a runtime, or silently switch providers. See [runtime contract](docs/bonsai.md).

The CLI will operate within one explicitly selected workspace. Exclusions apply before indexing and before any model or MCP response. Local application state belongs outside the notes directory; recovery records can contain note content and require a clear retention and deletion policy. Remote use requires explicit selection and consent.

## Development

Install the toolchain pinned in `rust-toolchain.toml` (Rust 1.85.1; MSRV 1.85.0; edition 2024). Build and verify with:
```sh
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked --release
python3 scripts/check-rust-boundaries.py
python3 scripts/test-native-pty.py
python3 scripts/smoke-native.py
```

Run `cargo run --locked -- --help`. Install from a checkout with `cargo install --locked --offline --path . --root <install-directory>`. The installed native binary runs without Node.js or Cargo. Existing npm commands exercise only superseded TypeScript work. See [foundation decisions](docs/cli-scaffold.md) and [release validation](docs/release-validation.md). No release has been published; publication requires explicit authorization. MIT license remains unchanged.
