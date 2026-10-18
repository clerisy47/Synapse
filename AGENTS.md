# AGENTS.md — Synapse

Standalone terminal platform for agentic Markdown workspace search/chat, locally reviewed research-to-note updates and scoped MCP collaboration. No embeddings, vector DB or telemetry. User revision 2026-10-18 selects Rust and supersedes all application-host and TypeScript CLI requirements. The native CLI now provides read-only chat/ask/JSON, offline search/source inspection, workspace/corpus and provider/queue/lease libraries. Reviewed research, persistent history, note writes/recovery and MCP remain unimplemented. Reuse logic if useful; there is no requirement to preserve existing code. The subsequent `$deliver` invocation authorized the Rust foundation. Do not continue TypeScript implementation. Preserve the existing interrupted code/dependency changes without treating them as the Rust baseline.

Read [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md). These are the current baseline; old host and TypeScript implementation results do not prove Rust CLI readiness.

## Task selection and reporting

User-directed revisions take precedence. Select the IN_PROGRESS task in PLAN; otherwise the lowest-ID TODO with DONE dependencies. If none qualifies, stop and report blockers. Update status only in PLAN.md; PROGRESS.md is narrative. Never claim gates complete without evidence.

Commit format: `[type]: [summary] (task [ID])`; types feat/fix/refactor/test/docs/chore/build. Wait 30 seconds before retrying the same failed problem; stop after 10 failed attempts and report evidence and suggested next steps. Preserve unrelated working-tree changes.

## Implementation rules

- Rust native executable built with Cargo, ports-and-adapters. Domain/features use typed port traits and validated newtypes. Filesystem/network/OS dependencies stay in adapters; terminal libraries stay in the terminal boundary. Public APIs use explicit module exports and `lib.rs` where applicable; `main.rs` is composition only. Prefer safe Rust; isolate and justify any `unsafe` in platform adapters with documented invariants and tests. No Node.js, TypeScript or Koffi runtime dependency in the product.
- One explicit canonical workspace per process. No home-directory scans, absolute/traversing note paths, symlink descendants or out-of-root access. Exclusions apply before ingest and at every tool/model/proposal/MCP output boundary.
- All model work through one JobQueue; coordinate local single-slot use across processes. Strict structured schemas and provider-specific builders. Models return bounded values and trusted destination/evidence IDs, never trusted paths, regex, quotes, grants or approvals.
- Runtime default: Bonsai 2 9B PQ2_0 via user-managed PrismML llama.cpp, numeric loopback 127.0.0.1:18080, 4,096 context, one slot, thinking disabled. Never download/start on launch. OpenRouter requires explicit selection and remote disclosure consent. No silent fallback; Ollama is not a substitute.
- Network only in allowlisted provider transports and explicit authenticated loopback MCP listener. No generic network/shell tools, telemetry or automatic URL fetching.
- Application state only through StateStore outside the workspace. Secrets via environment/OS credential adapter. Markdown mutation only through restricted approved-write, reviewed setup or scoped inbox-append ports. No delete/rename of user notes, autonomous application or model/MCP control-file edits.
- Exact local diff approval and explicit Apply bind current workspace, source/target bytes, instructions, exclusions and access configuration. No persisted approval, blanket yes flag or approval from piped stdin. Recheck before each write; journal intent and reconcile uncertain writes rather than retry blindly. Revert requires fresh review.
- Terminal renders untrusted text with control/escape sanitization. JSON output is versioned; stdout stays machine-readable and progress goes to stderr. Ctrl-C cancels work, restores the terminal and reconciles any begun write.
- Configurable Instructions.md and Research.md defaults are defined in SPEC. Never overwrite on setup. Search/chat need no control files. No Security.md feature or authored recipient grants/masks.
- MCP is disabled by default and independently scoped/authenticated. Clients may query permitted evidence or append unverified research, never approve/apply changes. Synapse cannot constrain separately granted filesystem access.
- Keep UI strings separate from logic and provisional limits in named constants/settings. Diagnostics never include note text, prompts, excerpts, credentials, raw errors or paths; sanitized intentional source/diff display is separate. Diagnostic paths use `h:` plus eight SHA-1 hex characters.

## Commands and verification

The Cargo workspace builds the native `synapse` foundation. Edition 2024, development toolchain 1.85.1 and MSRV 1.85.0 are pinned. Cargo.lock is committed. npm tooling is historical and is not part of product CI or packaging. Target checks are `cargo fmt --all -- --check`, `cargo check --locked --all-targets`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, and `cargo build --locked --release`; build `cargo build --locked --release --example terminal-driver` for the test harness; run `python3 scripts/check-rust-boundaries.py`, `python3 scripts/test-native-pty.py` and `python3 scripts/smoke-native.py` as well (PTY/install checks require a release build). Review dependencies, features, build scripts and licenses; no automatic legacy-state import.

Rust unit tests colocate with modules under `#[cfg(test)]`; Cargo integration tests and shared synthetic fixtures live under `tests/`. Existing `test/` content is historical until deliberately adapted and verified. Use meaningful temporary-filesystem, subprocess and PTY checks; no test weakening/deletion to pass a rewrite. Never hand-edit generated artifacts, commit secrets or real note content, or claim live-model/terminal/client gates based on mocks. No sub-agent delegation unless explicitly requested by the user or applicable instructions.

## Definition of done

Meet task acceptance, update PLAN, record material findings, pass relevant tests/static boundary/privacy checks and standalone build/install smoke once available. Real terminal, local Bonsai quality and native MCP interoperability require separate evidence. Publication requires explicit user authorization; packaging alone does not close release gates.
