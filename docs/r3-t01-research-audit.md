# R3-T01 research inbox capture and provenance

## Delivered behavior

The local **Capture research selection** command requires a nonempty selection in
the exact configured inbox (default `Research.md`). Save the editor buffer first.
The command snapshots only the selected material, records its processing history,
and leaves all vault files unchanged. It makes no model request. Generation,
diff review, approval, note writes and recovery remain their subsequent R3 tasks.

Implementation was split into contracts, state persistence, capture service and
fixtures, pure command presentation, plugin wiring/integration, and documentation.
Each implementation slice uses public module facades and injected ports; the
research module does not import state, Obsidian or Node. The composition root
injects the existing state store and confines persistence to `StoragePort`.

## Interfaces and identity

`createResearchInbox` exposes `capture`, `validateSnapshot`, `ledgerStatus` and
`dispose`. Facades return `Result`; public types are exported by `research/index.ts`.
`ResearchSnapshot` contains a readonly existing `ResearchBatch` and in-memory
untrusted selected text. Only snapshots minted by the current service pass local
snapshot validation; copied objects and snapshots from a prior service/restart do
not acquire authority. This identity check does not confer application approval.

Full-source and selected-content hashes use existing full SHA-256 over exact UTF-8
text, preserving whitespace and line endings. Ranges are nonempty half-open UTF-16
offsets; selections cannot bisect a surrogate pair. Selected text is bounded by
`CONTROL_LIMITS.markdownChars` (200,000). Batch ID is SHA-256 of stable serialization
of the canonical inbox path and selected-content hash. Source snapshot freshness
is separate from identity: an unrelated inbox append invalidates the old snapshot,
but recapturing unchanged selected material finds its existing processing history.
Repeated identical passages in the same inbox intentionally share identity.

Vault edits, deletion/rename, editor changes and service disposal invalidate
snapshots synchronously. Capture checks disk/editor agreement before hashing,
before persistence and after persistence. Settings rebuilds dispose the prior
service. Selection movement cannot expand the original capture request. The
active-editor port cannot inspect every inactive unsaved buffer; later application
must perform the separately planned all-target/editor checks before any write.

## Provenance, persistence and failure handling

Local capture records `local` provenance, describing the capture initiator. Pasted
external material is still unverified research. No Markdown/frontmatter field can
supply authenticated client identity, security grants, approval or an applied
outcome. Trusted external submission receipts and client/source metadata belong to
R4; the existing `external` provenance contract remains supported by ledger parsing.

The additive version-1 `researchLedger` field in `data.json` contains batch hashes,
paths/ranges, first/latest capture times, outcome history and conflict flags. It
contains no research body or approval token. Ledger metadata may sync with the
plugin folder; content hashes are fingerprints, not a confidentiality guarantee.
Existing state without this field loads an empty ledger. Clearing plugin state
clears this history while retaining settings and never touches the inbox or notes.

Outcomes are `captured`, `proposed`, `rejected`, `partially-applied` and `applied`.
This task records only `captured`; future trusted services record the others.
Recapture preserves all prior outcomes. Sync unions histories independently of
settings timestamps, chooses snapshot metadata deterministically and deep-clones
records. Rejection combined with partial/applied history or inconsistent identity
is a conflict that blocks that batch. Outcome data never grants write authority.

The provisional ledger cap is 1,000 entries. New local captures refuse at capacity;
duplicates can still refresh their snapshot. Malformed/unsupported known ledger
state globally blocks processing. If sync unions exceed the cap, it retains a
deterministic bounded prefix and sets a persistent global block; the incomplete
history is never treated as permission to replay omitted material. Resolving such
history requires deliberate recovery/reset work, not automatic eviction or retry.

Capture operations serialize, and success waits for a flushed plugin-state save.
Save failures return fixed redacted errors; subsequent explicit captures can retry
the state save chain. A failed save can leave a pending in-memory record, so a
successful retry may report it as a duplicate. Changes during save can leave a
captured metadata record but never yield a usable stale snapshot. Neither case
marks research applied. Late results from unload/rebuild cannot display notices.

## Verification

- 652 tests pass; one pre-existing opt-in live OpenRouter test remains skipped.
- Typecheck, lint (zero errors, eight existing warnings), boundaries (185 modules),
  network/write/four-model-schema checks, production build and whitespace pass.
- New fixtures cover exact Unicode/CRLF offsets, selection limits, injection,
  duplicates/edited batches, source/editor races, failed saves/retries, conservative
  sync and overflow, restart, exclusion from ordinary retrieval and disposal.
- Production bundle injected-host smoke passes capture, selection/dirty errors,
  duplicate recognition after restart, preserved inbox and complete listener unload.
  Reproduce after build with:
  `SYNAPSE_SMOKE_BUNDLE=1 npx vitest run test/integration/research-plugin.test.ts`.
- No live model request, real-vault write or real Obsidian UI verification was performed.
