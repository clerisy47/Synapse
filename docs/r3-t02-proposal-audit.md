# R3-T02 — bounded research proposal generation

> Historical evidence: Security.md support was removed on 2026-10-17. Use [current access contracts](control-contracts.md) for active requirements.

## Scope and implementation plan

Goal: turn an explicitly captured research selection and local destination choices
into immutable, approval-free note-change proposals. Keep source text, target
text and proposed Markdown in memory. Preserve ordinary search exclusion, the
single model lane, the sole OpenRouter request builder and the vault-write ban.

Implemented in reviewable slices:

1. `llm` schemas/public exports/schema checker and `constants.ts`: strict bounded
   `research.propose` response with destination IDs, Markdown and evidence IDs.
2. `jobs/queue.ts`: research job priority below interactive Q&A, using existing
   cancellation, preemption and retry behavior.
3. `policy`: selected-inbox/style-only access evaluation. Ordinary tool reads
   retain control-file denial; Security.md never becomes a research input.
4. `research/inbox.ts`: serialized, flushed, monotone proposed history without
   persisting proposals, note bodies, research text or approval authority.
5. `research/proposals.ts`: local routing, permitted context, model generation,
   deterministic assembly and freshness validation, with colocated fixtures.

## Public service boundary

`createProposalGenerator` takes vault, metadata, editor, inbox, control snapshot,
user exclusion, version, shared queue and model dependencies. Call
`generate({snapshot, destinations, dailyDate?})`; its JobHandle supports cancel and
returns `GeneratedProposal`. The snapshot must come from that inbox instance.
Destinations are explicit local routing IDs. A daily destination requires an
explicit date or exact relative token, interpreted by the existing timezone-aware
router. No date is inferred from research prose or model output.

The next task, R3-T03, composes this API into destination selection and full diff
review UI. This task adds no generation command or review surface to `main.ts`.
The existing capture command remains unchanged. R3-T04 supplies the restricted
writer; no proposal, processing state, model field or service return can approve
or apply a note change.

## Deterministic and disclosure rules

- Resolve only configured destinations or a plugin-constructed daily path. Reject
  missing choices, ambiguous dates, aliases, repeated targets and all control paths.
- Both privileged source/style inputs require current metadata, user exclusion
  checks and separate internal and remote read decisions. This explicit path is
  not used by search, tools or external clients. The injected exclusion policy
  includes user rules, without the automatic control-file ingest exclusion;
  ordinary corpus exclusion remains unchanged.
- Existing targets need internal write eligibility and separate local/remote read
  permission before context is disclosed. Missing targets use empty metadata for
  create eligibility; eventual application must validate proposed metadata and
  current policy through the later write gate.
- Literal replacements apply before serialization and input budgeting. Field
  masks on raw Markdown are refused. Complete replacement of a masked existing
  note is also refused, preserving hidden content; daily entries can be inserted
  locally while keeping original target text private. Literal masking applies
  conservatively across all free text to avoid cross-input repetition leaks.
- Model input contains opaque D1… destination IDs and E1… evidence IDs, not target
  paths. E1 binds the exact captured source range/hash; target IDs bind exact
  original content. Model output must cover every chosen target once, cite E1,
  use known evidence IDs, and contain no extra authority/path fields.
- Daily output must be a nonempty list entry. The plugin inserts it under the
  configured heading, preserving frontmatter, unrelated text, nested sections and
  line endings. Duplicate exact entries, repeated headings and unclosed fences or
  frontmatter are refused. Free-form instructions remain formatting guidance;
  their routing is parsed separately and never altered by model text.
- Source/editor/metadata events invalidate pending generation synchronously.
  Control/settings changes must update the injected host generation. Dirty
  metadata blocks fresh requests until publication. A synchronous current check
  guards every physical provider request/retry and late result. Disk and active
  target buffer contents are checked again before delivery. All returned proposal
  and provenance objects are deeply frozen and the proposal ID hashes its content.
- Success waits for a flushed approval-free proposed outcome. Applied, partially
  applied, rejected, conflicted or unavailable history blocks generation. Explicit
  retries flush even if an earlier failed save changed in-memory state.

Provisional bounds: eight targets, 48,000 serialized input characters, 8,000
characters per generated change and 4,000 output tokens. Inputs are refused, never
silently truncated. These bounds live in `constants.ts`.

## Verification

- 706 tests pass; the pre-existing opt-in live OpenRouter test is skipped.
- New fixtures cover timezone daily creation, CRLF update and multi-note output;
  immutable hashes/provenance; unknown/duplicate destinations and evidence;
  injection and forged approval/path fields; input/output limits; local/remote
  denial, exclusion, metadata publication, literal masking and unsupported masks;
  editor/disk/control/source races; cancellation, disposal and Q&A preemption;
  provider schema retry through the real OpenRouter client; and durable history
  save failures/retries without body persistence.
- Typecheck, lint (zero errors, eight existing warnings), boundaries (188 modules),
  network/write/five-schema checks, production build and whitespace checks pass.
- Existing production-bundle injected-host capture/restart/unload smoke passes:
  `SYNAPSE_SMOKE_BUNDLE=1 npx vitest run test/integration/research-plugin.test.ts`.
  This verifies the existing plugin host behavior, not a new proposal UI.
- No live model request, real-vault write or real Obsidian proposal UI validation
  was performed. Provider tests use synthetic in-memory transports and fixtures.
