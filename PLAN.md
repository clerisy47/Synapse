# PLAN: Synapse

Status: draft v2 · Revised 2026-10-14 · Inputs: SPEC.md and DESIGN.md v2.
This revision supersedes the old backlog, including the in-progress PDF probe M4-T01 and obsolete feature tasks. They are retired, not completed. Original statuses and task details remain in `docs/history/2026-10-14-scope-revision/PLAN.md` for history only.

## Execution rules

Current task is IN_PROGRESS; otherwise choose the lowest-ID TODO with all dependencies DONE. User-directed scope revisions take precedence over ordinary backlog selection. Status exists only here. R1-T01, R2-T01 through R2-T03 and R3-T01 are complete; no task is IN_PROGRESS.

Keep tasks small (normally 1–5 files); split cross-cutting cleanup into reviewable substeps before editing. Do not disable tests or delete meaningful failing coverage. Every implementation slice must build and load. Do not start Phase B until all Must + Should features and Phase A validation are complete.

## Revised milestone map

| Milestone | Result |
|---|---|
| R1 | Remove obsolete implemented features/scaffolding; preserve search and chat. |
| R2 | Instruction and security contracts, editable control files, recipient policy. |
| R3 | Research proposals, diff approval, restricted note writes, recovery. |
| R4 | Authenticated scoped MCP collaboration. |
| R5 | Search/chat completion, privacy validation, evaluation and Phase A release readiness. |
| R6 | Final switch to validated local Ollama. |

## Tasks

### R1-T01 — Revise implementation to match the new scope

- **Description:** Audit all obsolete code and split cleanup into 1–5-file substeps. Remove the PDF probe, probe builds/fixtures, PDF ports/source/page navigation branches, contradiction/claim/compare scaffolding, unused config/state/strings and obsolete dependency rules. Remove unused resurfacing scaffolding, including relevance schemas, scheduling, settings, and state. Keep meaningful search/chat/privacy tests; replace obsolete-feature tests with Markdown-only or migration assertions where appropriate. Update README and active checklists; do not delete historical docs or unrelated uncommitted work.
- **Dependencies:** none
- **Acceptance criteria:** SPEC F2/F3/F8; no obsolete command/build path; older settings/data load safely; search/chat/citation coverage preserved.
- **How to verify:** Audit references; typecheck, lint, boundaries, network/write/schema checks, npm test and build; plugin-host smoke.
- **Status:** DONE

### R2-T01 — Freeze control-file, recipient-policy and proposal contracts

- **Description:** Define core contracts and schemas for Security.md, Instructions.md, canonical routing, access contexts, proposal IDs and approval hashes. Add starter templates as repo assets, not writes to a real vault.
- **Dependencies:** R1-T01
- **Acceptance criteria:** SPEC F4/F6; deny precedence, missing/invalid rules, safe defaults and path validation specified.
- **How to verify:** Schema and policy-contract cases; review docs/templates consistency.
- **Status:** DONE

### R2-T02 — Load editable instruction and security files

- **Description:** Implement loaders/versioning and reviewed starter-file setup proposal; separate privileged reads from ordinary corpus. Invalidate on edits; define daily-note timezone/date behavior.
- **Dependencies:** R2-T01
- **Acceptance criteria:** SPEC F4; existing files never overwritten; conflicting/malformed control files handled visibly.
- **How to verify:** Loader/routing tests including midnight, ambiguous dates and file changes; build.
- **Status:** DONE

### R2-T03 — Enforce recipient-specific access and masking

- **Description:** Integrate deterministic permissions through tools/evidence/prompts/history/results; distinguish internal, remote provider, external client and write targets.
- **Dependencies:** R2-T02
- **Acceptance criteria:** SPEC F6; deny/mask tests across paths, tags, metadata, graph and stale policy; no prompt-only authorization.
- **How to verify:** Unit and integration payload/leak tests; full privacy checks.
- **Status:** DONE

### R3-T01 — Implement research inbox batch and provenance ledger

- **Description:** Read selected Research.md material, identify batches, record provenance and processing/idempotency states without clearing inbox.
- **Dependencies:** R2-T03
- **Acceptance criteria:** SPEC F5/F11; external input never grants permissions; edited batches invalidate snapshots.
- **How to verify:** Synthetic inbox, injection, duplicate and edited-batch tests.
- **Status:** DONE

### R3-T02 — Generate bounded note-change proposals

- **Description:** Use instruction/routing snapshots, permitted target context and schema-constrained generation through JobQueue. Resolve plugin-owned destination IDs, new daily paths and evidence provenance.
- **Dependencies:** R3-T01
- **Acceptance criteria:** SPEC F4/F5; correct daily-log format; no arbitrary path/control-file update; unresolved choices block apply.
- **How to verify:** Scripted-model daily-log and multi-note fixtures; invalid-schema/path/injection tests.
- **Status:** TODO

### R3-T03 — Build diff review and local approval UI

- **Description:** Full before/after Markdown diffs, per-change accept/reject, batch approval and stale snapshot checks; safe DOM and strings.
- **Dependencies:** R3-T02
- **Acceptance criteria:** SPEC F5; only local review issues bound approval; rejection/cancel writes nothing.
- **How to verify:** Viewmodel/DOM tests and real Obsidian review smoke.
- **Status:** TODO

### R3-T04 — Add restricted NoteWritePort and conflict-safe application

- **Description:** Implement one Obsidian write adapter; permit Markdown create/update and separately scoped inbox append. Recheck editor/disk state and approval before writing; narrowly migrate write checker.
- **Dependencies:** R3-T03
- **Acceptance criteria:** SPEC F5/F6; no delete/rename/control-file writes; changed or unsaved targets refuse stale apply.
- **How to verify:** Port contracts; concurrent edit/creation/policy/cancel integration cases; strict checks/build; real Obsidian apply smoke.
- **Status:** TODO

### R3-T05 — Add durable recovery, reapply prevention and reviewed revert

- **Description:** Journal per-file intent/outcome with bounded retention; reconcile after interruption and expose partial failure. Revert uses a new diff and approval.
- **Dependencies:** R3-T04
- **Acceptance criteria:** SPEC F11; exact applied report; preserved research; restart never blindly duplicates a write.
- **How to verify:** Fault injection between journal/write/completion, restart reconciliation and stale revert tests.
- **Status:** TODO

### R4-T01 — Design MCP transport and client capability contracts

- **Description:** Select supported authenticated local transport; freeze query_vault and submit_research schemas, pairing/revocation, limits, safe-reference format, allowlist and lifecycle changes.
- **Dependencies:** R3-T05
- **Acceptance criteria:** SPEC F7; no raw filesystem or apply tool; local endpoint security and scope model documented.
- **How to verify:** Contract/threat-case review and transport feasibility spike using synthetic data.
- **Status:** TODO

### R4-T02 — Implement authenticated local MCP adapter

- **Description:** Build isolated allowlisted server adapter and settings/lifecycle wiring with client capabilities, request/rate limits and revoke controls.
- **Dependencies:** R4-T01
- **Acceptance criteria:** SPEC F7; opt-in and local only; unauthorized requests reveal nothing; unload closes resources.
- **How to verify:** Authentication, malformed request, scope, limits and unload contracts/integration tests.
- **Status:** TODO

### R4-T03 — Expose policy-filtered query and scoped research submission

- **Description:** Wire semantic collaboration facades through access policy/JobQueue and serialized idempotent inbox append. Revalidate before replies; avoid forbidden title/path/count/error leaks.
- **Dependencies:** R4-T02
- **Acceptance criteria:** SPEC F6/F7; safe allowed/masked/denied answers; inbox-only client cannot read or edit target notes.
- **How to verify:** MCP client end-to-end with synthetic vault: masking, denial, injection, revocation, duplicate submission; real Obsidian/client smoke.
- **Status:** TODO

### R5-T01 — Complete iterative agentic retrieval and multi-turn chat

- **Description:** Audit/reuse existing bounded pipeline; implement missing follow-up search and current-policy history handling; verify all tool/citation paths are Markdown-only.
- **Dependencies:** R4-T03
- **Acceptance criteria:** SPEC F2/F3/F9; fixture requires a second search; forged/stale citations fail visibly.
- **How to verify:** Pipeline fixtures, policy change/history tests and citation navigation smoke.
- **Status:** TODO

### R5-T02 — Clear-data, privacy and diagnostics completion

- **Description:** Clear plugin state while preserving settings/control files/inbox/notes; disclose proposal recovery retention/sync and OpenRouter egress; finalize redacted diagnostics.
- **Dependencies:** R5-T01
- **Acceptance criteria:** SPEC F8/F10; no prompts/keys/content in diagnostics; clear warns about losing recovery history.
- **How to verify:** Clear/restart, redaction, exclusions, no-illegal-network/write and unload tests.
- **Status:** TODO

### R5-T03 — Synthetic evaluation and Phase A feature-complete gate

- **Description:** Build fixture/eval suite for Q&A, iterative retrieval, policy, research, review/apply and MCP. Use openrouter/free for live tests; report failure rather than switching models.
- **Dependencies:** R5-T02
- **Acceptance criteria:** SPEC F1–F11 acceptance criteria; zero forbidden disclosure/write; all parsed schemas valid; citation validity at least 95%; manual gaps closed.
- **How to verify:** Required checks/build, deterministic eval, live OpenRouter with synthetic inputs and real Obsidian workflow evidence.
- **Status:** TODO

### R5-T04 — Phase A release readiness

- **Description:** Finalize settings/a11y/docs/license/release pipeline, artifact version hygiene and install smoke. This milestone gates Phase B; the final local product remains pending.
- **Dependencies:** R5-T03
- **Acceptance criteria:** SPEC F8 release criteria; only three release artifacts; all Must + Should complete and verified.
- **How to verify:** Release dry run, clean-vault install and feature checklist.
- **Status:** TODO

### R6-T01 — Implement and switch default to local Ollama

- **Description:** Add Ollama client behind ModelPort, loopback policy/health and settings migration; no silent cloud fallback.
- **Dependencies:** R5-T04
- **Acceptance criteria:** SPEC Phase B/F1; all workflows execute with local inference; absent Ollama fails visibly without blocking plugin load.
- **How to verify:** Mock transport/client tests plus real local feature smoke after Phase A gate.
- **Status:** TODO

### R6-T02 — Local evaluation and final release

- **Description:** Run full quality/privacy/latency suite locally; measure hardware floor and recommend only evaluated models; final docs and release install validation.
- **Dependencies:** R6-T01
- **Acceptance criteria:** SPEC success criteria locally; measured limitations recorded; local default and optional remote opt-in disclosed.
- **How to verify:** Local eval report, all required checks/build and real Obsidian/MCP/research/chat release smoke.
- **Status:** TODO

## Completed baseline history

The prior walking skeleton, Markdown corpus/tools and cited chat tasks remain completed historical work. Their original criteria do not imply completion of revised F1–F11 requirements.

- M1-T01 — Decide identity and freeze constants — **Status:** DONE
- M1-T02 — Scaffold package and build — **Status:** DONE
- M1-T02b — Test runner, lint, and CI — **Status:** DONE
- M1-T02c — Boundary and privacy check scripts — **Status:** DONE
- M1-T03 — Core types and Result/Error — **Status:** DONE
- M1-T04 — Port interfaces and Clock/Logger/Observable — **Status:** DONE
- M1-T05 — Model-output schemas (zod) + subset check — **Status:** DONE
- M1-T06 — Config store (zod settings) — **Status:** DONE
- M1-T07 — State store: tolerant parse + merge — **Status:** DONE
- M1-T08 — Fake ports for CI — **Status:** DONE
- M1-T09 — Node HTTP transport — **Status:** DONE
- M1-T10 — OpenRouter client + health checker — **Status:** DONE
- M1-T11 — Job queue (single lane) — **Status:** DONE
- M1-T12 — Policy: endpoint + exclusion stubs — **Status:** DONE
- M1-T13 — Obsidian storage + lifecycle adapters — **Status:** DONE
- M1-T14 — Status bar + notices viewmodels/UI — **Status:** DONE
- M1-T15 — Settings tab (endpoint, model, transport warning) — **Status:** DONE
- M1-T16 — Wire composition root (deployable slice) — **Status:** DONE
- M1-T18 — Walking-skeleton acceptance checklist — **Status:** DONE
- M2-T01 — Exclusion policy integration tests — **Status:** DONE
- M2-T02 — Corpus store + DocTable + warm loop — **Status:** DONE
- M2-T03 — Text index (folded) — **Status:** DONE
- M2-T04 — Link graph (invert resolvedLinks) — **Status:** DONE
- M2-T05 — Tag, title, frontmatter, note-date indexes — **Status:** DONE
- M2-T06 — Tool registry + canonical keys — **Status:** DONE
- M2-T07 — Tools: search_text, search_by_title, read_note — **Status:** DONE
- M2-T08 — Tools: links, backlinks, tags — **Status:** DONE
- M2-T09 — Tools: frontmatter + list_recent — **Status:** DONE
- M2-T10 — Obsidian vault/metadata adapters + wire corpus — **Status:** DONE
- M3-T01 — Evidence segmentation + ledger — **Status:** DONE
- M3-T02 — Anchor resolve — **Status:** DONE
- M3-T03 — Agent state machine + budgets — **Status:** DONE
- M3-T04 — Selectors + prompts — **Status:** DONE
- M3-T05 — QaPipeline.run (end-to-end core) — **Status:** DONE
- M3-T06 — Chat viewmodel + view — **Status:** DONE
- M3-T07 — Commands + ribbon for chat — **Status:** DONE
- M3-T08 — NavigationPort citation clicks — **Status:** DONE
- M3-T09 — Q&A integration test (mock OpenRouter) — **Status:** DONE

## Retired backlog

The prior PDF, contradiction, compare-for-flags, and old eval/release tasks have been replaced rather than marked DONE. M4-T01 no longer governs current work. The old M1-T17 local bake-off is replaced by R6-T02 and remains strictly after feature completion. Daily resurfacing is removed from the current scope; its unused scaffolding is included in R1-T01.

## Definition of done

Acceptance criteria met; required tests/checks/build pass; no illegal runtime imports/network/writes; no sensitive logs; plugin load and required manual behavior verified; status updated here.
