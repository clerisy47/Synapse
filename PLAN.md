# Synapse implementation plan

Baseline reset: 2026-10-18. This plan replaces all previous task IDs and release gates. The documentation pivot is complete; implementation has started. No old feature completion status transfers to the terminal platform. The subsequent request to perform the remaining plan authorizes implementation.

Status lives only here. Select the IN_PROGRESS task, otherwise the lowest-ID TODO with all dependencies DONE. Each task includes docs and meaningful checks for its behavior. Do not mark a task DONE based on historical implementation tests.

| ID | Status | Dependencies | Task and acceptance |
|---|---|---|---|
| CLI-T00 | DONE | — | Rewrite current product, architecture, plan, progress, research, contributor and operational docs; remove obsolete host documentation; leave code untouched. |
| CLI-T01 | DONE | CLI-T00 | Replace application scaffold with a terminal executable. Decide Node/platform baseline, terminal library, state layout and package naming. Remove former host code/dependencies/assets/build/release configuration as needed; no compatibility requirement. Establish strict TS, checks, CLI help/version, explicit root validation and clean temporary-directory install smoke. No old runtime remains a release artifact. |
| CLI-T02 | IN_PROGRESS | CLI-T01 | Implement canonical workspace reader, exclusions, validated metadata, bounded lexical/link index, evidence coordinates and watcher invalidation. Test traversal/symlinks, malformed/oversized files, live changes and excluded-content absence. |
| CLI-T03 | TODO | CLI-T02 | Implement structured Bonsai/OpenRouter adapters, explicit consent, health/offline behavior, one queue and cross-process single-slot lease, cancellation and budgets. Verify no runtime auto-start/download/fallback and opt-in synthetic Bonsai health. |
| CLI-T04 | TODO | CLI-T03 | Deliver interactive chat and one-shot ask/JSON with bounded retrieval, verified sources, insufficient evidence, three-turn memory and source inspection. Test real PTY, piped streams, Unicode/escape injection, Ctrl-C and content-free diagnostics. |
| CLI-T05 | TODO | CLI-T04 | Implement reviewed starter setup, instructions/routing, research capture/ledger, metadata repair proposals and exact per-file diff review. No writes from generation; no approval from stdin/JSON/model. Test preserved bytes, ambiguous dates, protected controls and stale review. |
| CLI-T06 | TODO | CLI-T05 | Implement restricted apply, shared workspace locks, exclusive creates, durable intent/outcome journal, conflict checks, uncertain-write reconciliation, reviewed revert and history clearing. Crash/competing-writer tests; document residual filesystem races; no delete/rename of notes. |
| CLI-T07 | TODO | CLI-T06 | Verify/pin MCP protocol and SDK, implement explicit loopback service, local credential lifecycle, independent scopes, safe query projection, idempotent inbox append and revocation. Test real native-client interoperability, listener teardown, limits and concurrent CLI writes. |
| CLI-T08 | TODO | CLI-T07 | Run privacy/security and quality evaluation: synthetic known-answer and unsupported questions, research provenance/destination checks, explicit remote consent, malicious notes, exclusion invalidation and retention bounds. Record denominators, failures, timings, configured runtime and reproducible commands. |
| CLI-T09 | TODO | CLI-T08 | Finalize standalone packaging/docs and supported-platform matrix; clean install/upgrade/uninstall, real terminal and native-client release checks. Remove stale build outputs via tooling, verify artifact contents, publish only after explicit release authorization. |

## Release gates

All CLI tasks must meet their acceptance criteria, required checks and standalone build/install smoke. Quality and real-terminal/client gates stay open until evidenced. See [release validation](docs/release-validation.md). A working legacy build does not close any CLI gate.
