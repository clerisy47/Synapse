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

## Workspace reader and corpus

2026-10-18: RUST-T02 is implemented in the isolated `Synapse-rust-t02` delivery checkout. Fetching origin revealed RUST-T01 had already merged as PR #131; the original local plan was stale. The original checkout and every uncommitted documentation/TypeScript/dependency change remain untouched. This delivery starts at main `4230052`.

The new Unix adapter pins the canonical root and opens every descendant component using read-only descriptor-relative no-follow operations. It skips symlinks/special files, checks device/inode before publishing and refuses root/ancestor replacement. State-root overlap and existing state symlinks are refused without persistence. Core policy/metadata validation filters hidden/control/folder/tag/ignore content. The bounded corpus provides deterministic lexical discovery, permitted inline Markdown/wiki graph/backlinks, attention paths, instance/generation-bound evidence IDs and exact body-line coordinates. Every output API polls current bytes; policy/content/read failures invalidate evidence. See [workspace decisions](docs/rust-workspace.md) for syntax, bounds, dependency review and filesystem limitations.

Synthetic tests cover excluded/invalid/outside sentinel absence, UTF-8/malformed/oversized metadata, YAML reference amplification, traversal configuration, explicit selected-root aliases, state overlap/symlinks, exact evidence lines, independent corpus IDs, same-length live edits, create/delete/root replacement, changed policy/frontmatter, link/backlink bounds, aggregate/entry/depth limits and unchanged source bytes. The concurrency regression runs 500 scans against 500 ancestor directory/symlink replacement cycles; every successful scan excludes outside bytes. A first test attempt found a temporary-fixture name collision; a monotonic process-local fixture counter fixed it. Clippy identified an unnecessary recursive receiver, which was removed. Neither failure weakened assertions.

Local verification passed on macOS 26.6.2 (25G83), aarch64-apple-darwin: `cargo fmt --all -- --check`, `cargo check --locked --all-targets`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked` (18 tests), `python3 scripts/check-rust-boundaries.py`, `cargo build --locked --release`, `python3 scripts/test-native-pty.py` and `python3 scripts/smoke-native.py`. `cargo +1.85.0 check --locked --all-targets` and `cargo +1.85.0 test --locked --workspace` also passed all 18 tests. The installed executable ran outside the checkout with PATH excluding Node/Cargo/Rust. `otool -L target/release/synapse` reports system libiconv.2.dylib and libSystem.B.dylib. Documentation relative links and `git diff --check` passed. CI independently validates Ubuntu/macOS plus MSRV on the final PR. No live model, native MCP, chat/ask, persistence or write/recovery gate is closed. The graph supports common inline destinations/wikilinks, not a complete CommonMark parser; polling is scheduled by callers rather than a background event thread. Concurrent ordinary edits can overlap a read, so this is not a filesystem transaction. Release platform qualification remains open.

## RUST-T03 provider foundation

The subsequent delivery adds a closed synthetic-health task, Bonsai/OpenRouter-specific schema builders, fixed endpoint HTTP/TLS, session remote-consent capability, bounded response validation, one serial bounded JobQueue and a shared private-state OS lease. No fallback, runtime startup, downloads, automatic URL fetching or credential discovery is added. CLI integration and live quality remain later evidence; see docs/rust-providers.md for exact bounds and cancellation limitations.

Initial synthetic HTTP testing exposed a fixture closing its socket before draining the request body; the corrected server reads Content-Length before responding. Initial Clippy findings rejected test unwrap calls; fixtures now use explicit panic failures without changing production error handling or weakening lint policy. A subsequent concurrent run exposed timestamp-only temporary-directory name collisions; fixtures now include an atomic sequence as well as PID/time. State directory acquisition was hardened to open every component with no-follow and revalidate directory/lock identity. Real subprocess tests prove contention and release after process death. The opt-in live Bonsai probe is present but has not been run. No live model identity, quality, runtime slot cancellation, real terminal provider UI or MCP interoperability gate is claimed.

2026-10-18 local verification on macOS arm64: pinned 1.85.1 formatting, locked all-target compiler check, warning-free Clippy, 27 passing Rust tests (two ignored entries: subprocess helper and opt-in live probe), boundary/dependency/schema/network/write policy check, release build, real PTY foundation smoke and clean temporary-directory native installation passed. Rust 1.85.0 MSRV all-target check and workspace tests also passed. CI must independently verify Linux/macOS; live Bonsai has not been contacted. The original dirty checkout remains untouched; delivery uses an isolated worktree based on current origin/main.
