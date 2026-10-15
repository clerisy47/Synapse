# Durable recovery and reviewed revert

R3-T05 adds an approval-free `recovery.json` in the plugin folder, accessed only
through `StoragePort`. It records the exact accepted binding, full before/after
Markdown, ordered per-file outcomes and optional parent recovery ID. No serialized
record grants write authority. No model request is needed for recovery or revert.

## Application and interruption

The independent research ledger flushes its conservative batch-attempt marker
before journaling. A journal record precedes application, and a durable pending
intent precedes each write. The restricted adapter still rechecks current source,
controls, permissions, editor buffers and destination content. Success is recorded
after the adapter resolves. A failed journal save stops subsequent writes; an
already confirmed success remains reported as applied. Unknown host outcomes
remain pending/unknown on disk until observation can establish their state.

Plugin startup and both review commands reconcile uncertain records without
writing to notes: exact proposed content means applied; exact original content
(or absence for a create) means unchanged; other observed content means conflicted.
Read failures remain unknown. Existing empty files and absent files are distinct.
Reconciliation never resumes a batch, issues authority, clears research, or resets
the independent replay ledger. Startup surfaces stopped/uncertain histories through
a fixed notice. The recovery command presents record IDs and ordered outcomes;
paths and bodies remain hidden until current local review checks succeed.

## Revert

Use **Review recovery and revert**, then **Review revert diff** on an application
with confirmed applied files. A fresh local review shows complete reversed content
for applied files only. Reverting a newly created note proposes an empty Markdown
file: deletion remains prohibited. Accept/reject each change, approve, and explicitly
apply. Merely opening, rejecting or closing a review changes no notes.

A revert binds current research, instruction and policy snapshots and the exact
applied destination content. Current exclusions, read/write policy, control-file
text, editor buffers and target hashes are rechecked before showing the proposal,
on approval and before each write. An edited target refuses revert rather than
merging. Reverts get their own journal and require new single-use local authority.
A recorded revert attempt prevents a second revert of that parent; revert-of-revert
is intentionally unavailable. Partial revert attempts need manual review of remaining
files; there is no automatic retry or rollback.

## Retention and privacy

Full note text and trusted paths are sensitive plugin data, not diagnostics.
Apply and recovery UI disclose storage and possible vault-sync/backup copying.
Limits live in `RECOVERY_LIMITS`: 20 records, 4,000,000 serialized characters, and
30 days. Expiry is processed on startup or journal access, not by a background timer.
Unresolved pending/unknown records survive expiry; a full journal refuses new work.
The separate hash-only inbox ledger retains replay prevention after text expires.

Malformed JSON/schema, binding-hash mismatch, persistence failure or observed
external journal divergence refuses further application. External divergence needs
inspection and reload; journals are not merged by settings timestamps. StoragePort
has no cross-device transaction primitive: simultaneous multi-device editing is not
a distributed-lock guarantee. A torn journal fails closed. Deleting plugin data or
restoring old backups loses recovery evidence; complete clear-data UX and warnings
remain R5-T02 release work. No approval capability, API key, prompt, or source inbox
body is added to recovery storage or logs. Target before/after bodies are retained.

## Validation

Automated coverage includes intent/completion save faults, pre/post-write crashes,
restart reconciliation, concurrent edits, empty-file creation, corrupted/external
state, replay, bounded retention, fresh local revert, stale/excluded/dirty targets,
policy edits, unchanged inbox, cancellation and unload. Disk-backed cases copy the
project mini vault to disposable directories. Production-bundle host smoke exercises
capture, review, journaled application and unload with a scripted provider response.
Real Obsidian workflow evidence remains at R5-T03/R5-T04 under the revised PLAN.
