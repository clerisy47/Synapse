# Synapse

Synapse is a Rust terminal agent for a local Markdown workspace. It brings a Codex CLI-style conversation and review workflow to searching notes, answering with verified sources, and turning rough research into approved note changes.

No embeddings, vector database, or telemetry. Local Bonsai inference is the default; OpenRouter is an explicitly selected remote option.

## Project state

Only Markdown with valid description, tags and aliases frontmatter participates in ordinary retrieval; see [workspace requirements](docs/rust-workspace.md). The native Rust CLI supports interactive read-only conversation, offline lexical search/source inspection and one-shot `ask --json`. Answers contain exact verified source passages; unsupported questions return insufficient evidence. Reviewed research, note writes/recovery, persisted chat history and MCP remain pending. [Chat contracts and evidence](docs/rust-chat.md) document bounds, cancellation and limited live smoke results. Historical TypeScript/host sources stay outside Cargo/native artifacts.

Start with [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md). [PROGRESS.md](PROGRESS.md) records the current handoff. Old implementation results do not establish CLI readiness.

## Intended workflow

Available read-only commands:

```sh
synapse --workspace ~/Notes
synapse ask --workspace ~/Notes "What have I learned about decision trees?"
synapse ask --workspace ~/Notes "What have I learned about decision trees?" --json
```

The interactive terminal shows retrieval progress and exact passages with numbered sources and file/line locations. Use `/search <terms>` without a model, `/source <number>` to inspect current evidence, and `/quit` to exit. Reviewed diffs and research/doctor commands remain future work. Search and chat work without instruction files. Planned research uses configurable `Synapse/Instructions.md` and `Research.md`; future setup must never overwrite existing files. Changes need exact local review and explicit Apply. Planned MCP clients may query permitted notes or submit research with granted scopes; they cannot approve or apply changes.

## Runtime and privacy

Default model: Bonsai 2 9B PQ2_0 through user-managed PrismML llama.cpp at `127.0.0.1:18080`, 4,096 context, one slot, thinking disabled. Synapse will not download weights, launch a runtime, or silently switch providers. See [runtime contract](docs/bonsai.md).

The CLI operates within one explicitly selected workspace. Exclusions apply before indexing and before any model or MCP response. Local application state belongs outside the notes directory; recovery records can contain note content and require a clear retention and deletion policy. Remote use requires explicit selection and consent.

## Development

Install the toolchain pinned in `rust-toolchain.toml` (Rust 1.85.1; MSRV 1.85.0; edition 2024). Build and verify with:
```sh
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked --release
cargo build --locked --release --example terminal-driver
python3 scripts/check-rust-boundaries.py
python3 scripts/test-native-pty.py
python3 scripts/smoke-native.py
```

Run `cargo run --locked -- --help`. Install from a checkout with `cargo install --locked --offline --path . --root <install-directory>`. The installed native binary runs without Node.js or Cargo. Existing npm commands exercise only superseded TypeScript work. See [foundation decisions](docs/cli-scaffold.md) and [release validation](docs/release-validation.md). No release has been published; publication requires explicit authorization. MIT license remains unchanged.

The Rust workspace reader and corpus library now provide capability-scoped reads, metadata/exclusions, bounded lexical/link retrieval and fresh evidence IDs. See [workspace behavior and limits](docs/rust-workspace.md). These APIs now drive chat, ask and source inspection. OpenRouter requires explicit selection, a model ID, local terminal disclosure/consent and an environment credential; see the chat contract.
