# Rust terminal release validation

Native development qualification is recorded for macOS 26.6.2/aarch64 in [the evidence report](evidence/native-qualification-2026-10-19.md). Publication has not occurred; other platforms and live remote-provider quality are unclaimed. [Foundation decisions](cli-scaffold.md) distinguish target Rust requirements from superseded TypeScript scaffold evidence. Old host and TypeScript tests/installations do not close Rust gates.

| Gate | Required evidence |
|---|---|
| Build/install | Pinned Rust edition/toolchain/MSRV and Cargo.lock; compiler/format/Clippy/test and boundary/network/write/schema checks; versioned native executable archive with verified contents; clean install/help/version/upgrade/uninstall on every claimed OS/architecture/libc target without Node.js or Rust tooling; no model weights, application state or former host/TypeScript artifacts |
| Workspace | Explicit root; read-only permissions; UTF-8/large/malformed files; exclusion before ingest; traversal/symlink/race tests; deterministic metadata/links/source coordinates |
| Terminal | Real TTY/PTY conversation, resizing/narrow widths, Unicode, NO_COLOR, malicious escape strings, source/diff inspection, Ctrl-C/EOF and terminal restoration |
| Automation | Redirected stdout/stderr, versioned JSON, exit codes, no accidental writes/approval from piped input, no secrets/raw errors |
| Providers | Offline local behavior, queued/cancelled health/chat/research, cross-process single-slot coordination, structured schema/context checks, explicit remote selection/consent, no fallback |
| Quality | Reproducible synthetic known-answer and unsupported cases on configured Bonsai, current citations, research routing/provenance, complete failures/denominators and latency; deterministic checks distinguished from live model quality |
| Review/writes | Full exact diff, accepted subset, stale snapshots, competing processes/editors, exclusive create, cancellation/crashes around durable intent/write/outcome, uncertain reconciliation and newly approved revert |
| MCP | Pinned protocol/Rust SDK, actual native client, authentication/scopes/revocation, safe projection, bounded inputs, concurrent append and idempotency recovery, listener cleanup |
| Privacy/state | No excluded content/keys/prompts in diagnostics or egress, OS-local state permissions, secret storage, retention/capacity behavior, clear-history warning preserving notes/configuration |

Each evidence record needs date, commit, platform/runtime, synthetic fixture identity, exact command, expected/actual outcome, failures and limits. Do not commit real notes, credentials or raw model transcripts. Run Cargo formatting, compiler and Clippy checks, meaningful Rust tests, architecture/network/write/schema checks and native build/install smoke established in RUST-T01. Verify the chosen MSRV separately from the development toolchain and record target triple, dependency/build-script requirements and binary runtime dependencies. The Cargo scaffold now exists; README lists the available native verification commands. Packaging or a passing health probe alone cannot close a workflow gate.

Publication is a separate explicitly authorized action after all required evidence is available. Until then describe artifacts as development builds.
