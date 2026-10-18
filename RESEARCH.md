# Synapse engineering research

Revision: 2026-10-18. This file tracks engineering questions for the terminal platform. It is separate from a user's workspace `Research.md` inbox. It records a research agenda, not newly measured results or verified library recommendations.

## Lessons carried forward

Lexical, metadata and link retrieval can support Markdown answers without embeddings. Preserve bounded tool expansion, exact phrase handling, final-hop evidence delivery, body-supported citations, structured model validation and explicit insufficient-evidence answers as design considerations. Revalidate all of these in the CLI; prior host results do not establish new-platform quality.

Local Bonsai remains the chosen runtime. A 4,096-context, single-slot configuration makes prompt budgets, bounded history, queueing and cross-process coordination material. Do not infer broad reliability from a health check or isolated synthetic success.

## Questions and required evidence

| Question | Investigation | Decision task |
|---|---|---|
| Terminal implementation | Compare a minimal line session with maintained rendering libraries; demonstrate PTY lifecycle, cancellation, narrow widths and safe untrusted output before choosing. | CLI-T01 |
| Distribution and support | Verify Node baseline, executable packaging, supported OS installs, permission behavior and clean uninstall. | CLI-T01 / CLI-T09 |
| Filesystem containment | Exercise canonical roots, symlink replacement, hard links, permissions, case sensitivity and watcher invalidation on intended platforms. Refuse unsupported mutation cases. | CLI-T02 / CLI-T06 |
| State and credentials | Choose OS state directories and credential storage; test permissions, symlink refusal, root identity, configuration versioning and no automatic legacy import. | CLI-T01 / CLI-T03 |
| Concurrent edits and crashes | Test two CLI processes, independent editors, MCP appends and termination around each journal/write boundary. Document residual races and conservative recovery. | CLI-T06 |
| Model quality | Use seeded synthetic fixtures with known facts, unsupported questions, malicious instructions, routing and citations. Record every attempt, exact runtime, latency and denominators. | CLI-T08 |
| MCP compatibility | Verify a current versioned official protocol and SDK against an actual native client before pinning; keep wire conformance separate from authority tests. | CLI-T07 |

## Evidence policy

Keep real note content, credentials, prompts and raw provider responses out of committed evidence. Use synthetic fixtures and aggregate/content-free results. Record date, commit, command, environment, expected outcomes, failures and limits. Distinguish deterministic infrastructure checks, live-model checks, real-terminal checks and native-client checks. No new browsing, benchmark or runtime test was performed for the documentation pivot.
