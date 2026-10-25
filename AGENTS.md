# AGENTS.md — Synapse

Standalone terminal platform for agentic Markdown workspace search/chat, automatic research-to-note updates (including create/edit/delete/rename) and scoped MCP collaboration. No embeddings, vector DB or telemetry. The product is a native Rust/Cargo CLI; keep it Rust-only. No Node.js, TypeScript or Koffi runtime dependency.

User-directed revisions take precedence. Never claim gates complete without evidence. Preserve unrelated working-tree changes.

Commit format: `[type]: [summary]`; types feat/fix/refactor/test/docs/chore/build. Wait 30 seconds before retrying the same failed problem; stop after 10 failed attempts and report evidence and suggested next steps.

## Implementation rules

- Rust native executable built with Cargo, ports-and-adapters. Domain/features use typed port traits and validated newtypes. Filesystem/network/OS dependencies stay in adapters; terminal libraries stay in the terminal boundary. Public APIs use explicit module exports and `lib.rs` where applicable; `main.rs` is composition only. Prefer safe Rust; isolate and justify any `unsafe` in platform adapters with documented invariants and tests.
- One explicit canonical workspace per process. No home-directory scans, absolute/traversing note paths, symlink descendants or out-of-root access. Exclusions apply before ingest and at every tool/model/proposal/MCP output boundary.
- All model work through one JobQueue; coordinate local single-slot use across processes. Strict structured schemas and provider-specific builders. Models return bounded values and trusted destination/evidence IDs, never trusted paths, regex, quotes, grants or approvals.
- Runtime default: Bonsai 2 9B PQ2_0 via user-managed PrismML llama.cpp, numeric loopback 127.0.0.1:18080, 4,096 context, one slot, thinking disabled. Never download/start on launch. OpenRouter requires explicit selection and remote disclosure consent. No silent fallback; Ollama is not a substitute.
- Network only in allowlisted provider transports and explicit authenticated loopback MCP listener. No generic network/shell tools, telemetry or automatic URL fetching.
- Application state only through StateStore outside the workspace. Secrets via environment/OS credential adapter. Markdown mutation only through journaled auto-apply (create/replace/delete/rename), setup starters or scoped inbox-append ports. Models and MCP never edit control files. MCP never applies destination-note mutations.
- Local note mutations auto-apply without interactive accept/Apply. Recheck workspace, source/target bytes, instructions, exclusions and access configuration before each write; journal intent and reconcile uncertain writes rather than retry blindly. `--preview` is dry-run only. High research contradiction severity still writes and records a flag report; it does not block. Revert auto-applies when journaled inverse is still valid.
- Terminal renders untrusted text with control/escape sanitization. JSON output is versioned; stdout stays machine-readable and progress goes to stderr. Ctrl-C cancels work, restores the terminal and reconciles any begun write.
- Configurable Instructions.md and Research.md defaults; never overwrite on setup. Search/chat need no control files. No Security.md feature or authored recipient grants/masks.
- MCP is disabled by default and independently scoped/authenticated. Clients may query permitted evidence or append unverified research, never apply, delete, rename or edit destination notes. Synapse cannot constrain separately granted filesystem access.
- Keep UI strings separate from logic and provisional limits in named constants/settings. Diagnostics never include note text, prompts, excerpts, credentials, raw errors or paths; sanitized intentional source/diff display is separate. Diagnostic paths use `h:` plus eight SHA-1 hex characters.

## Commands and verification

Pinned Rust/MSRV and committed Cargo.lock apply. Target checks:

```
cargo fmt --all -- --check
cargo check --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked --release
```

Also run boundary checks via `python3 scripts/check-rust-boundaries.py` when touching adapter boundaries. Review dependencies, features, build scripts and licenses; no automatic legacy-state import.

Rust unit tests colocate with modules under `#[cfg(test)]`; Cargo integration tests and shared synthetic fixtures live under `tests/`. Use meaningful temporary-filesystem, subprocess and PTY checks; no test weakening/deletion to pass a rewrite. Never hand-edit generated artifacts, commit secrets or real note content, or claim live-model/terminal/client gates based on mocks. No sub-agent delegation unless explicitly requested by the user or applicable instructions.

## Definition of done

Meet the requested acceptance criteria, pass relevant tests/static boundary/privacy checks and standalone build/install smoke when those paths are touched. Real terminal, local Bonsai quality and native MCP interoperability require separate evidence. Publication requires explicit user authorization; packaging alone does not close release gates.
