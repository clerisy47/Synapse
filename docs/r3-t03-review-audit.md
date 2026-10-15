# R3-T03 — local research review and approval

## Implementation plan and result

Connect selected saved research to configured destination/date selection, queued
proposal generation, complete local Markdown review and exact bound approval.
Keep the note writer, recovery journal and write-checker migration in R3-T04/R3-T05.

Implemented sequentially in small slices:

1. `changes`: local in-memory approval registry, exact accepted-subset binding,
   fail-closed validation, identity-checked single-use consumption and revocation.
2. `ui`: pure review reducer/controller, explicit accept/reject decisions and
   lifecycle guards. Stale and canceled states remove proposal text immediately.
3. `ui`: command captures before modal focus moves; configured destinations and
   explicit daily dates precede generation. Side-by-side panels show complete
   original/proposed Markdown, destination, operation, provenance and evidence IDs.
4. Obsidian modal adapter: injected rendering/actions, one-time cleanup on close,
   Escape or plugin unload. Styles remain scoped; model Markdown stays literal.
5. `research`: per-review session composes existing inbox/generator with approval
   and read-port freshness checks. The architecture allowlist explicitly permits
   research to consume the public changes facade; no adapter or write dependency.
6. Composition root: register Review research, use the shared JobQueue and current
   OpenRouter lane, and close/dispose sessions on service rebuild or unload.

## Public service boundaries

`createReviewApproval({proposal, paths, validate, version})` owns a parsed,
immutable proposal clone. `approve(decisions)` requires an accept/reject decision
for every change, at least one accepted change, and no proposal issues. It hashes
only accepted changes in displayed order, including exact source/target/control
snapshots and complete before/after text. Decisions are copied before awaiting.
Validation runs before and after hashing; synchronous generation checks protect
all asynchronous boundaries. Only the local review composition receives this
capability. Model fields, ledger state and parsed Approval objects confer no
authority.

`consume(approval)` accepts only the exact object issued by that registry, burns
it before awaiting freshness validation, and returns an immutable binding once.
It performs no write. Invalidations revoke issued authority. R3-T04 must connect
this boundary to its restricted writer and recheck before every actual write;
this task does not expose an Apply action or retain tokens for later sessions.

`createResearchReviewSession` owns capture, queued generation, validation and
subscriptions for one modal lifetime. UI consumes a structural runner interface,
so it does not import research or changes implementations. Source/target/editor,
metadata, controls and settings events synchronously invalidate current review
and cancel pending generation. Approval also rereads exact disk content, checks
case aliases and missing/new files, checks active editor buffers, validates the
inbox ledger and rechecks local read/write permissions and exclusions. Both
control-file texts are hashed against the bound loader snapshots, even when
host events were missed. Source/style metadata are rechecked too.

The modal shows all Markdown without rendering it as HTML or truncating it.
Every change starts undecided. All-rejected batches cannot issue approval; close
simply abandons the review. Closing/canceling/rebuilding/unloading discards bodies
and authority. The existing approval-free captured/proposed history is preserved;
rejection does not add a terminal ledger outcome. No note text or approval is
persisted or logged, no vault writes are added, and all write/network checks stay
unchanged. Generated Markdown editing requires a future fresh proposal; v1 review
is read-only.

## Verification

- Full suite: 743 tests pass; the existing optional live OpenRouter test is skipped.
- Typecheck, lint (zero errors; ten warnings), boundary/network/write/schema
  checks, production build and whitespace validation pass.
- Production-bundle injected-host smoke passes for capture/restart, real command
  composition into the review modal, chat and unload. The VM harness supplies
  structuredClone, matching the renderer global used by production services.
- Synthetic integration tests cover complete inert create/update review, selected
  subsets, absent daily dates, unchanged inbox/targets, approval-free persistence,
  changed/deleted/alias targets, dirty editors, stale controls/settings/metadata,
  missed source/target/control events, queue cancellation and late results.
- Registry tests cover exact bindings, immutable ownership, undecided/empty
  selection, unresolved issues, restricted paths, serialized-token forgery,
  validation errors, revocation and concurrent issue/consumption.
- Real Obsidian operator evidence (2026-10-15): the user reported **Pass** for
  [the synthetic-vault review checklist](r3-t03-review-smoke.md), using their
  “latest” Obsidian version. A numeric version was not supplied. This is operator
  evidence, separate from the injected-host tests. No live provider call was
  performed by the coding agent; no alternate model was selected.

## Remaining boundaries

Review approval intentionally saves no notes. R3-T04 still owns writer and editor
conflict handling at application time; R3-T05 owns durable recovery, reapply
prevention and reviewed revert. No recovery, MCP or Phase B work is included.
