# R3-T04 restricted application

## Goal and implementation slices

Apply only the locally accepted subset, preserve Research.md and refuse stale or
unverifiable state. No general vault writer, control update, delete/rename,
folder creation, provider change or MCP endpoint is added.

1. Core write/report contracts, the sole Obsidian note adapter and narrow checker
   migration (`core/note-write.ts`, `adapters/obsidian/note-write.ts`, exports,
   adapter tests, `check-no-writes.mjs`).
2. Consume local single-use authority; persist a conservative batch-attempt marker;
   validate source, controls, targets, policy/exclusions and buffers before each
   operation; stop sequentially and retain exact per-file results (`changes/apply`,
   `research/review`, `research/inbox`, integration tests).
3. Add explicit Apply and inert result display, wire the adapter in main, verify
   real composition with a scripted provider and document the manual host check.

## Boundaries

`NoteWritePort.apply` receives a plugin-resolved change, local revalidation gate,
abort signal, synchronous generation guard and editor snapshots. Only research
review is composed with it. Models, parsed approval data, external clients and
saved state never receive local registry authority. The changes service consumes
that exact authority once before any application attempt. It never retries writes.

The adapter validates canonical Markdown paths and distinct control paths,
rejects inbox/control destinations for note application, checks case aliases and
file kind, and checks every open Markdown leaf. Background, dirty or unavailable
buffers for source, controls and targets refuse application. Existing targets use
Obsidian `Vault.process`: its synchronous callback compares full original text,
checks buffers and generation immediately before returning replacement text.
Creation uses `Vault.create` only for an absent destination; no folders are made.
A concurrently existing file is never intentionally overwritten.

Review rechecks saved research and both exact control-file hashes, target content,
current policy and exclusions, metadata, editor state and settings before every
write. Only the committing target's own create/modify/metadata notifications are
suppressed during its operation; other events invalidate authority. Completed
files must still match their approved resulting text before later writes.
Missing/stale metadata can conservatively stop a multi-file batch. This is a
refusal, not permission to assume an unverified snapshot is safe.

`ResearchAppendPort` is a distinct factory-bound capability. Its request has no
destination. It may only append to the configured existing inbox, compares full
original content, checks editors and revalidates its bound gate. It cannot create
or update control files. No appender is composed in main: authentication,
recipient policy, limits, idempotency and live MCP wiring remain R4 tasks.

The write checker permits only `vault.create` and `vault.process` in the named
adapter. It also bans direct append/folder creation elsewhere; the adapter is
not exempted from delete, rename, modify or raw storage-write prohibitions.

## Results and persistence limits

Application is sequential, not atomic. The UI reports applied, refused, unknown
and not-attempted destinations literally. A host failure after submitting a write
is unknown; it is never reported as proof that no write occurred. Failure stops
subsequent writes. Closing/unload aborts pending work; an already committed
operation remains. No automatic rollback or retry occurs.

Before the first attempt, plugin state flushes `partially-applied` for the batch.
A failed flush prevents writes. This conservative marker blocks regeneration of
that batch, including when a crash occurs before the first write; it is not an
exact applied-file journal. All-success completion attempts an `applied` marker.
If completion persistence fails, the conservative marker still blocks replay.
Only approval-free hashes/history are persisted, never source/target bodies or
authority. R3-T05 owns per-file intent/outcome journaling, restart reconciliation,
bounded recovery retention and reviewed revert. Those features are not complete.

## Verification

Verification: 774 tests pass; one optional live OpenRouter test is skipped.
Typecheck, lint (zero errors, eleven warnings), boundaries (205 modules),
network/write/five-schema checks, production build and whitespace checks pass.
Production-bundle capture/review/apply/chat/unload smoke passes.

Automated adapter, service, DOM and integration tests cover approved subsets,
multiple sequential writes, concurrent disk/edit/creation, all-pane editor guards,
control/path restrictions, scoped append, stale policy, cancellation, forged
approval, replay, failed persistence, partial failure and unknown host outcomes.
The production-bundle injected-host test runs command → Generate (scripted
response, shared queue) → Approve → Apply → persistence → unload. It checks the
actual note adapter call and unchanged inbox. This is not a live provider call or
a real Obsidian application.

Real Obsidian application evidence is pending via
[r3-t04-apply-smoke.md](r3-t04-apply-smoke.md). PLAN R3-T04 stays IN_PROGRESS until
that required check is completed; this document does not waive it.
