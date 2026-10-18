# Synapse progress

## Native foundation

2026-10-18: The subsequent `$deliver` request authorized the next eligible plan task. The native foundation is implemented in an isolated delivery checkout from origin/main; PLAN.md remains the sole task-status authority. The original checkout, its 16 ahead commits, Rust documentation edits and interrupted TypeScript/Koffi changes are preserved. The Rust documentation baseline is carried into this delivery so the feature branch is reviewable against the published main branch; none of the interrupted TypeScript edits is included.

The native Cargo workspace uses edition 2024, development toolchain 1.85.1 and MSRV 1.85.0. Four dependency-free library crates separate core, application, adapters and terminal; main only composes them. Cargo.lock records five local MIT packages with no external features or build scripts. Standard-library plain text rendering and cooperative cancellation avoid terminal/async dependencies at this stage. Foundation decisions freeze the future external state layout and the development platform targets.

Available behavior: help/version, explicit canonical root validation and sanitized intentional root display in a real terminal. A valid interactive invocation returns NOT_IMPLEMENTED (1); redirected interactive input returns INTERACTIVE_REQUIRED (3) before root access. Missing/file roots return INVALID_WORKSPACE (2). Invalid commands return USAGE (2). Diagnostics are fixed codes with no raw OS error, path or question. No note scanning, persistence, network, model download/start, approval or write API exists.

CI now builds native Cargo code on Ubuntu 22.04 x86_64 and macOS 14 arm64 and separately checks the MSRV. A manual development-candidate workflow archives only the executable and LICENSE. No release/publication is performed. Legacy host sources and npm tooling are excluded from Cargo and artifacts, retained as historical material rather than migrated or automatically imported.

## Reproducible local evidence

Environment: macOS 26.6.2 (25G83), aarch64-apple-darwin. Synthetic fixtures only: generated temporary root directory/file/symlink; malicious Unicode/OSC root name; fixed invalid CLI arguments. No notes or live model data were used.

Commands from the delivery checkout:

```sh
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo +1.85.0 check --locked --workspace --all-targets
cargo +1.85.0 test --locked --workspace
python3 scripts/check-rust-boundaries.py
cargo build --locked --release
python3 scripts/test-native-pty.py
python3 scripts/smoke-native.py
otool -L target/release/synapse
```

Seven Rust tests cover path syntax, shared monotonic cancellation, explicit directory validation/selected-root symlink resolution, CLI help/version/usage, redirected refusal and control sanitization. Real PTY checks cover sanitized root display, fixed missing-root errors and absence of workspace writes. The install smoke uses a temporary directory outside the checkout and a PATH without Node/Cargo/Rust; help/version pass and piped Apply/yes is refused. `otool` reports only /usr/lib/libSystem.B.dylib. Dependency inventory and mutation probes enforce current crate/network/write/absent-model-schema policies. These lexical checks supplement compiler boundaries and do not prove descendant containment. All listed local checks passed on development Rust 1.85.1; the compiler and seven tests also passed on MSRV 1.85.0. Documentation relative links and git diff whitespace checks passed. CI results for the final commit are recorded in the PR.

## Remaining evidence

The original interrupted TypeScript changes to cli/adapters/node/reader.ts, cli/adapters/node/posix-reader.ts, package.json and package-lock.json remain only in the original checkout. Historical TypeScript/host quality, test and install reports do not close any Rust feature gate.

Root canonicalization alone cannot secure descendant access against ancestor replacement; no descendant API is exposed yet. Capability-scoped reads, exclusions/index/evidence/watchers, structured providers and single-slot queue, chat/JSON, complete terminal lifecycle, reviewed setup/research, restricted writes/recovery, scoped native MCP and live quality remain assigned to later tasks. State layout is selected but persistence/permissions/overlap rejection remain unimplemented. Platform release qualification, upgrade/uninstall and publication remain open.
