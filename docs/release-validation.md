# Terminal release validation

CLI scaffold build/install evidence is recorded in [scaffold decisions](cli-scaffold.md). It does not close product release gates. Old application-host tests are not standalone release evidence.

| Gate | Required evidence |
|---|---|
| Build/install | Versioned executable package, verified contents, clean install/help/version/upgrade/uninstall on every claimed OS/Node version; no model binaries/weights or former host artifacts |
| Workspace | Explicit root; read-only permissions; UTF-8/large/malformed files; exclusion before ingest; traversal/symlink/race tests; deterministic metadata/links/source coordinates |
| Terminal | Real TTY/PTY conversation, resizing/narrow widths, Unicode, NO_COLOR, malicious escape strings, source/diff inspection, Ctrl-C/EOF and terminal restoration |
| Automation | Redirected stdout/stderr, versioned JSON, exit codes, no accidental writes/approval from piped input, no secrets/raw errors |
| Providers | Offline local behavior, queued/cancelled health/chat/research, cross-process single-slot coordination, structured schema/context checks, explicit remote selection/consent, no fallback |
| Quality | Reproducible synthetic known-answer and unsupported cases on configured Bonsai, current citations, research routing/provenance, complete failures/denominators and latency; deterministic checks distinguished from live model quality |
| Review/writes | Full exact diff, accepted subset, stale snapshots, competing processes/editors, exclusive create, cancellation/crashes around durable intent/write/outcome, uncertain reconciliation and newly approved revert |
| MCP | Pinned protocol/SDK, actual native client, authentication/scopes/revocation, safe projection, bounded inputs, concurrent append and idempotency recovery, listener cleanup |
| Privacy/state | No excluded content/keys/prompts in diagnostics or egress, OS-local state permissions, secret storage, retention/capacity behavior, clear-history warning preserving notes/configuration |

Each evidence record needs date, commit, platform/runtime, synthetic fixture identity, exact command, expected/actual outcome, failures and limits. Do not commit real notes, credentials or raw model transcripts. Run typecheck, lint, boundaries/network/write/schema checks, meaningful tests and standalone build/install smoke using the scripts established in CLI-T01. Packaging or a passing health probe alone cannot close a workflow gate.

Publication is a separate explicitly authorized action after all required evidence is available. Until then describe artifacts as development builds.
