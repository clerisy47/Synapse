# Synapse engineering research

Revision: 2026-10-18. This file tracks engineering questions for the Rust terminal platform. It is separate from a user's workspace `Research.md` inbox. It records a research agenda, not newly measured results or verified library recommendations.

## Lessons carried forward

Lexical, metadata and link retrieval can support Markdown answers without embeddings. Preserve bounded tool expansion, exact phrase handling, final-hop evidence delivery, body-supported citations, structured model validation and explicit insufficient-evidence answers as design considerations. Revalidate all of these in the CLI; prior host results do not establish new-platform quality.

Local Bonsai remains the chosen runtime. A 4,096-context, single-slot configuration makes prompt budgets, bounded history, queueing and cross-process coordination material. Do not infer broad reliability from a health check or isolated synthetic success.

## Questions and required evidence

| Question | Investigation | Decision task |
|---|---|---|
| Terminal implementation | Compare a minimal Rust line session with maintained Rust terminal libraries; demonstrate PTY lifecycle, cancellation, narrow widths and safe untrusted output before choosing. | RUST-T01 |
| Distribution and support | Pin Rust edition/toolchain/MSRV; verify native binary packaging, target triples, supported OS/architecture installs, runtime dependencies, permission behavior and clean uninstall. | RUST-T01 / RUST-T09 |
| Filesystem containment | Exercise canonical roots, symlink replacement, hard links, permissions, case sensitivity and watcher invalidation on intended platforms. Evaluate descriptor-relative or equivalent capability-scoped Rust APIs; canonicalize-then-open does not close ancestor replacement races. Refuse unsupported access/mutation cases. | RUST-T02 / RUST-T06 |
| Rust dependencies and execution | Choose async runtime/cancellation, argument parsing, serialization, strict schemas, YAML and HTTP/TLS crates; review maintenance, features, native/build requirements and licenses before pinning. | RUST-T01 / RUST-T03 |
| State and credentials | Choose OS state directories and credential storage; test permissions, symlink refusal, root identity, configuration versioning and no automatic legacy import. | RUST-T01 / RUST-T03 |
| Concurrent edits and crashes | Test two CLI processes, independent editors, MCP appends and termination around each journal/write boundary. Document residual races and conservative recovery. | RUST-T06 |
| Model quality | Use seeded synthetic fixtures with known facts, unsupported questions, malicious instructions, routing and citations. Record every attempt, exact runtime, latency and denominators. | RUST-T08 |
| MCP compatibility | Verify a current versioned official protocol and compatible Rust SDK against an actual native client before pinning; keep wire conformance separate from authority tests. | RUST-T07 |

## Evidence policy

Keep real note content, credentials, prompts and raw provider responses out of committed evidence. Use synthetic fixtures and aggregate/content-free results. Record date, commit, command, environment, expected outcomes, failures and limits. Distinguish deterministic infrastructure checks, live-model checks, real-terminal checks and native-client checks. No new crate research, benchmark or runtime test was performed for this Rust documentation revision. Existing TypeScript checks and the interrupted Koffi/POSIX experiment do not select Rust dependencies or prove containment. Runtime, crate and protocol choices require verification during their implementation tasks.
