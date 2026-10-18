# Synapse progress

## Current focus

Documentation now describes a standalone terminal Markdown platform with a Codex CLI-style interaction model. The subsequent request to perform the remaining plan authorized implementation. The CLI scaffold now builds and installs independently; workspace indexing is next in PLAN.md. Product commands remain unavailable.

## Last session

2026-10-18: User replaced the application-host direction with a terminal platform and requested document rewrites only. Replaced README, SPEC, DESIGN, PLAN, RESEARCH and contributor instructions. Removed obsolete host audits, historical specifications and setup/deployment guides from the documentation surface. Added terminal contracts for explicit workspaces, safe rendering, noninteractive output, local approval, filesystem confinement, process locking, recovery, scoped MCP and release evidence. No source, test, dependency, workflow, generated starter or build artifact changes were made for this pivot.

Retained product decisions: Markdown-only lexical/graph retrieval; verified evidence; reviewed research-to-note updates; local Bonsai default; explicit OpenRouter selection/consent; exclusions; no embeddings/vector DB/telemetry; optional scoped MCP. Existing code need not be preserved or reused. Prior validation is not CLI acceptance evidence.

## Known issues

- Runnable CLI scaffold exists; chat, model, research, approved writes and MCP commands are not yet implemented.
- Working tree already contained implementation and documentation changes before the pivot. Documentation was rewritten deliberately; pre-existing non-document changes were left untouched.
- Plain text terminal, provisional Node 22/macOS/Linux targets, state layout and package identity are selected in docs/cli-scaffold.md. Filesystem replacement strategy and MCP wire pin remain undecided.
- Real terminal, filesystem crash/concurrency, live Bonsai quality and native MCP-client gates remain unevidenced for the CLI.

## Shortcuts taken

No code migration in this session, as requested. Old host documentation was removed rather than maintained as an alternative architecture. Git history remains available for historical investigation.

## Decisions not in DESIGN.md

None.

## Rules to add to AGENTS.md

None.

## Implementation evidence — 2026-10-18

CLI-T01: established a separate strict TypeScript CLI, help/version, canonical explicit-root validation, sanitized root display, redirected-input refusal, and an allowlisted executable package. Removed former host dependencies from the active package, retaining existing source and tests outside the CLI artifact. Updated CI and development artifact workflow. Decisions and limits are in docs/cli-scaffold.md.

On Darwin 25.6.0 arm64, Node 22.23.3: clean `npm ci --ignore-scripts`, typecheck, scaffold static checks, four scaffold tests, and one actual tarball/install test passed. Node 23.10.0 checks also passed. No full terminal/model/MCP/recovery/release evidence is claimed. The working tree remains uncommitted and includes pre-existing changes.

CLI-T02 work: added filesystem reader, bounded UTF-8 reads, path/exclusion filtering, YAML validation, lexical retrieval, link/backlink and recent discovery, application-owned source coordinates, fresh evidence checks and native watcher invalidation. Ten scaffold/corpus tests and a separate install test passed before adding incremental directory iteration and the depth-cap regression. The fixture canonical-root correction addressed the observed macOS temporary-root failures without relaxing reader containment. CLI-T02 remains open: concurrent ancestor-directory replacement containment, application-state path exclusions and further resource-limit checks need evidence before provider work. Models, chat, review, writes and MCP remain unimplemented in the CLI.

Final scaffold/workspace verification: 11 tests plus the clean tarball/install test passed on Node 23.10.0 after incremental directory scanning and the depth-bound regression were added. Typecheck and static scaffold checks also passed. Directory iteration is bounded incrementally rather than materializing unbounded directory listings. The ancestor-replacement race remains an explicit open verification item; this build is a development scaffold, not a safe-to-release workspace agent.

The final 11-test workspace/scaffold suite and separate tarball/install test also passed on Node 22.23.3, together with typechecking.
