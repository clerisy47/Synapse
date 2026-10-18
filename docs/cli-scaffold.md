# Rust foundation decisions

2026-10-18 · RUST-T01 native foundation.

The workspace package `synapse-cli` builds the `synapse` native executable. Registry publication is disabled; no crate-name availability is claimed. Edition 2024 uses development toolchain 1.85.1 and MSRV 1.85.0. The [Rust edition guide](https://doc.rust-lang.org/edition-guide/rust-2024/) documents 1.85.0 as the edition minimum. CI runs the MSRV compiler/tests separately. Cargo.lock is generated and committed.

## Boundaries and dependencies

Original RUST-T01 boundary decisions (extended by RUST-T02 below): `synapse-core` has no dependencies; application and adapters depend only on core; terminal depends on application/core. The binary composes the native adapter and terminal. Explicit exports live in each lib.rs. Core contains typed errors, a validated relative Markdown newtype, a root-validation port and cooperative cancellation. Filesystem root validation stays in adapters. Main contains composition only.

At RUST-T01 there were no third-party dependencies, optional features, native build scripts or FFI. RUST-T02 dependencies are reviewed in the workspace document below. All five workspace packages use MIT. The standard library supplies argument iteration, IsTerminal, output and plain text rendering; no raw/full-screen mode needs restoration. Arguments accept only help/version or one explicit workspace. No write/approval command exists. No Node step runs in CI or packaging. Historical source and npm dependencies remain inert outside Cargo/artifacts, including the interrupted local TypeScript changes preserved in the original checkout.

Execution is synchronous for the foundation. Cooperative cancellation uses AtomicBool with acquire/release ordering; future blocking workers use standard threads/channels behind ports, with one JobQueue and provider lease in RUST-T03. No async runtime is adopted before network requirements are evaluated. Ctrl-C currently uses the OS default because no long-running session or terminal mode is entered. This does not prove the future cancellation/recovery gate.

## State and platform decisions

Freeze future state layout: macOS `~/Library/Application Support/Synapse/workspaces/<SHA-256-canonical-root>`; Linux `$XDG_STATE_HOME/synapse/workspaces/<SHA-256-canonical-root>`, falling back to `~/.local/state/synapse/workspaces/<identity>`. Relative XDG values must be refused. Persisted history is not implemented. RUST-T04 lazily provisions only the private global state root and provider lock during model work, through StateStore. Before persistence, adapters must reject overlapping workspace/state roots, symlinked state components and enforce private permissions. No automatic legacy import.

Development targets are aarch64-apple-darwin (macOS 14+) and x86_64-unknown-linux-gnu (Ubuntu 22.04/glibc 2.35+). Native builds use system linking; do not claim portability to older runtimes. Windows, Intel macOS, Linux arm64 and musl are unqualified. RUST-T09 must qualify install/upgrade/uninstall and runtime portability. Development archives contain only `synapse` and LICENSE; publication is separate.

## Behavior and verification

`--help` and `--version` work without workspace access. Interactive mode requires stdin and stdout TTYs before validating the selected root. Missing/file roots fail with fixed `INVALID_WORKSPACE` and exit 2; redirected interactive use returns `INTERACTIVE_REQUIRED`, exit 3. The original foundation returned NOT_IMPLEMENTED after displaying the root. RUST-T04 now opens the read-only chat/search/source loop and one-shot ask/JSON; roots remain sanitized and explicit. OS failures never print raw errors, selected paths or questions in diagnostics. Root display is intentional local content.

Checks: formatting, compiler, Clippy and seven Rust tests; dependency graph/license/features/build-script inventory plus lexical capability guards and mutation probes; real PTY malicious-root display and missing-root refusal; native install outside the checkout with PATH excluding Node/Cargo/Rust. RUST-T03 evolves the network/write/schema checks for reviewed provider/schema ports and the state-only lease exception; see [provider foundation](rust-providers.md). Note mutation APIs remain prohibited. Lexical checks supplement compiler crate boundaries; they do not prove filesystem containment.

Canonicalizing the selected root does not secure descendant access against ancestor replacement. RUST-T02 adds descriptor-relative reads, metadata/exclusions, lexical/link retrieval and polling invalidation as library APIs; see [workspace decisions and evidence limits](rust-workspace.md). RUST-T04 now calls these APIs through chat/ask/search/source. [Chat decisions](rust-chat.md) record JSON, signal handling, state-only provisioning and limited live evidence; complete state/privacy, quality, writes/recovery and native MCP gates remain open.
