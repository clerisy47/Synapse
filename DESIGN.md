# Synapse terminal architecture

Revision: 2026-10-18 · Rust baseline. Target design; not a description of the current source tree. A clean implementation is allowed. Reusing algorithms is optional; preserving modules, host abstractions, settings migrations, tests, or packaging is not required.

## 1. Process and lifecycle

A native Rust executable built with Cargo owns one canonical Markdown workspace per invocation. The foundation pins edition 2024, development toolchain 1.85.1 and MSRV 1.85.0, verified separately in CI. End users do not need Rust, Cargo, Node.js or an FFI bridge installed to run a distributed binary. Startup parses arguments, canonicalizes the explicit root, loads external local state/configuration, applies exclusions, and builds a bounded Markdown index. A missing model runtime leaves deterministic search/diagnostics available and yields an actionable model error. It never starts a server or downloads weights.

Interactive terminal mode, one-shot read-only mode, and explicitly started MCP service share application facades. Terminal exit closes watchers/listeners, cancels jobs, invalidates approvals and restores terminal state. A separate MCP process uses the same workspace locking and journal discipline; no implicit background daemon. One model lane per process and a workspace-level provider lease prevent concurrent invocations from exceeding the configured single local slot.

## 2. Layers and ports

Target dependency direction: terminal/composition -> application facades -> domain/core ports. Adapters implement typed Rust port traits and depend on core. Domain and feature modules do not perform filesystem, network, process, terminal or OS credential I/O; dependencies arrive through narrowly scoped traits. Public module APIs use explicit exports from `mod.rs` or module files, and library crates expose `lib.rs`. Keep `main.rs` as composition and lifecycle wiring only. Choose crate boundaries in RUST-T01 so checks can enforce dependency direction.

| Area | Responsibility |
|---|---|
| core | Typed `Result` errors, validated workspace-path newtypes, opaque evidence/approval IDs, port traits, clocks and cancellation |
| config/policy | Validated configuration, exclusions, remote consent, access snapshots |
| corpus/tools/evidence | Bounded Markdown index, lexical/graph retrieval, current passage resolution |
| agent | Structured planning/answering, budgets, one JobQueue, verification |
| research | Capture, routing, proposals, exact review snapshots, apply/recovery/revert |
| collaboration | Authenticated scoped query and idempotent research submission |
| terminal | Input, sanitized rendering, source/diff display, progress and JSON serialization |
| adapters | Rust filesystem, persistence, locking, watcher, credential, provider transport and MCP listener implementations; platform-specific code stays here |

Ports: WorkspaceReadPort, RestrictedNoteWritePort, ResearchAppendPort, SetupWritePort, StateStore, CredentialStore, ModelTransport, WorkspaceLock, TerminalPort, Clock. Distinct write capabilities prevent a generic filesystem writer from reaching feature code. Network only in explicitly allowlisted transports/listener; filesystem I/O only in adapters. Configuration defaults and budgets are named constants. Prefer safe Rust; isolate any necessary `unsafe` code in small platform adapter modules with documented invariants and focused tests. Do not expose raw descriptors or generic I/O capabilities to domain code. Do not use production `unwrap`/`expect` for untrusted data or fallible I/O. Map internal errors to fixed public codes before diagnostics.

## 3. Retrieval and evidence

Scan only eligible Markdown files. Apply exclusions before metadata/body indexing. Index titles, validated metadata, text terms, links and backlinks without embeddings. Filesystem events invalidate generations; reread affected files and invalidate pending evidence/approvals. Watchers are hints, not write-conflict authority: fresh filesystem checks are mandatory at use time.

The bounded agent plans structured tool calls, retrieves passages, evaluates evidence, optionally follows links/reads and produces verified claims or insufficient evidence. Reaching a hop cap may still permit a final answer from accumulated evidence within remaining budget. Models return bounded terms/enums/text/evidence IDs, never trusted paths/regex/quotes/permissions. Resolve citations from application-owned passages and current bytes. Terminal users see numbered sources with relative path/line ranges; MCP receives a separate ordinal projection without internal paths or traces. Index metadata never substitutes for body support.

## 4. Terminal boundary

Start with an accessible text-oriented interactive session; select the rendering library in RUST-T01 based on TTY support, cancellation, testability and dependency cost. Do not make full-screen rendering a first-release prerequisite. Keep domain state out of renderer callbacks. Sanitize all untrusted terminal text, including filenames and errors, before rendering; application-generated styling is separate. Wrap using terminal display width and test Unicode, narrow terminals, redirected streams and NO_COLOR.

Review displays complete exact diff content, escaping terminal controls without silently altering approved file bytes. If output cannot be reviewed completely, refuse approval and provide a safe inspection flow. JSON has a versioned schema, stable source coordinates and no styling; errors use fixed public codes. Credentials never enter ordinary stdout or JSON. Token provisioning is a separate deliberate local action.

## 5. State and filesystem safety

Store private application state in an OS-appropriate user state directory, keyed by canonical workspace identity, outside the workspace. Resolve platform paths through a dedicated adapter; exact layout is frozen in RUST-T01. Use restrictive permissions and reject symlinked state files. Configuration is versioned; secrets come from environment or OS credential storage rather than ordinary JSON. Do not import old application state automatically.

Reject traversal, absolute note paths, symlinked descendants and out-of-root resolution. Canonicalization followed by a path-based open is insufficient against ancestor replacement. Use descriptor-relative or equivalent capability-scoped access with no-follow checks for each component, stable workspace identity and fresh evidence validation. Verify the Rust filesystem abstraction and its platform semantics in RUST-T02; fail closed where containment cannot be guaranteed. Keep OS-specific primitives within Rust adapters; the interrupted TypeScript/Koffi experiment is not a chosen dependency or validated solution. Serialize mutation through an exclusive workspace lock shared by CLI and MCP processes. Bind approved proposals to canonical root, identities/hashes and current access/instruction generations. Stage exact bytes, journal intent durably, revalidate and replace one file at a time. Exclusive-create prevents overwrite of a concurrently created target. Atomic rename is per-file only; unrelated editors do not honor Synapse locks, so document and test the final check-to-replace race and select the narrowest supported strategy. No claim of global atomicity.

The journal is recovery evidence, never authority to resume edits. Reconcile before/after hashes on startup. Unknown outcomes stop relevant new work. Revert requires a fresh exact diff approval. State clearing first quiesces writers/listeners and preserves notes/configuration. Full note content in recovery has explicit bounds, retention and disclosure.

## 6. Provider and collaboration boundaries

Default Bonsai runtime and explicit remote OpenRouter remain the only supported providers; see [runtime contract](docs/bonsai.md). Builders validate supported schema subsets and input budgets for the configured 4,096 context. One queue handles health, chat, research and MCP, with interactive work prioritized and bounded starvation. Cancellation suppresses late output; write cancellation follows recovery rules.

MCP uses an explicit loopback service process and durable hashed scoped credentials. Its protocol version and Rust SDK compatibility must be verified during RUST-T07, before freezing the wire implementation. [MCP contract](docs/contracts/mcp-v1.md) defines product authority and bounds. Revocation invalidates queued work and late delivery. External submission serializes with all note writes and cannot borrow interactive approval.

## 7. Verification and decisions

Use pure domain tests, real temporary-directory adapter tests, subprocess tests, pseudo-terminal tests, crash injection, and opt-in synthetic live-model evaluation. Terminal tests must prove behavior rather than mirror rendering internals. Required security regressions cover excluded content, malicious terminal controls, traversal/symlinks, stale approvals, competing processes, remote consent and untrusted research instructions.

Binding decisions: Rust native executable built with Cargo; standalone CLI; Markdown only; no generic shell tool; explicit workspace; independent local state; local Bonsai default; no silent fallback; exact local approval; scoped optional MCP; no obligation to reuse code. Foundation choices are recorded in [foundation decisions](docs/cli-scaffold.md). Deferred choices: serialization/schema validation and YAML libraries, HTTP/TLS transport, filesystem capability/replacement strategy and MCP protocol/Rust SDK pin. Commit Cargo.lock for the application when establishing the scaffold; dependency features, build scripts, native requirements and licenses are reviewed before adoption. Resolve these with evidence in their implementation tasks rather than inheriting host-specific choices.

## 8. Build and verification contract

RUST-T01 establishes a Cargo application and reproducible checks: `cargo fmt --all -- --check`, `cargo check --locked --all-targets`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, and `cargo build --locked --release`. These commands run against the native foundation. Add enforceable dependency-boundary, allowlisted-network, restricted-write and structured-schema checks; compiler safety does not prove application authority or containment. Document whether optional features require additional checks.

Unit tests live beside Rust modules under `#[cfg(test)]`; Cargo integration tests live in `tests/` with synthetic fixtures. Use real temporary filesystems, subprocesses, PTYs and crash/concurrency checks where relevant. Validate an installed native `synapse` binary from outside the checkout. CI and release workflows must build Rust artifacts and exclude former host/TypeScript outputs, npm packages, model weights and application state. No npm step or Node.js runtime is part of the target product build.
