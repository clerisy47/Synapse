# DESIGN: Synapse

Status: draft v2 · Revised 2026-10-17 · Binding input: SPEC.md v2.
This is the target architecture, not a claim that planned features already exist. The previous detailed design is historical under `docs/history/2026-10-14-scope-revision/`.

## 1. Product and provider phases

Markdown agentic search, cited vault chat, instruction-guided research-to-note proposals, and scoped MCP collaboration. The 2026-10-17 user revision defaults to Bonsai 2 4B PQ2_0 via user-managed PrismML llama.cpp now. OpenRouter is an explicitly selected remote option; no fallback. No embeddings, vector DB, telemetry, PDFs, contradiction finding, or daily resurfacing.

## 2. Architecture

### 2.1 Layers

Ports-and-adapters with a plain strict TypeScript core. `main.ts` constructs dependencies and registers lifecycle only. Features contain no Obsidian, Node, or Electron APIs. Only `adapters/obsidian` and `adapters/node` import those runtimes. Every module exports through `index.ts`; imports across modules use that facade.

| Layer/module | Responsibility and permitted dependencies |
|---|---|
| core | Branded paths, Result/errors, port contracts, clock/logger; no other modules. |
| config, state, evidence, jobs, llm | Core services; core and injected contracts. |
| policy | Deterministic exclusions, fixed access contract, capability checks; core. |
| instructions | Control-file loading, schema validation, versioning and routing; core and policy. |
| corpus | Markdown-only cache/indexes and filtered graph; core, policy, evidence. |
| tools | Bounded retrieval; core, evidence; injected corpus/access contracts. |
| agent | Search/chat orchestration; core, evidence, tools, llm and jobs public contracts. |
| research | Inbox batches, proposal generation, local review sessions and provenance; core, instructions, policy, evidence, agent, llm, jobs, changes contracts. |
| changes | Proposal validation, approval binding, application and recovery; core, policy, instructions, state contracts. |
| collaboration | Scoped MCP operations and safe responses; core, policy, agent, research, jobs contracts. |
| ui | Pure viewmodels and DOM shells for chat, review, settings; public feature contracts, no adapters. |
| adapters | Implement injected core ports; no feature imports. |
| main.ts | Sole composition root; may import all public facades. |

This table is the target allowlist. Boundary-rule changes land alongside modules, without granting broad runtime imports. Existing module restrictions remain enforced until their planned migrations.

### 2.2 I/O and write boundary

`VaultPort` and `MetadataPort` provide reads/events for Markdown. `StoragePort` remains confined to the plugin folder for settings and state. Introduce a separate `NoteWritePort` for narrowly scoped Markdown create/update operations. Its sole production implementation lives in `adapters/obsidian/note-write.ts`; callers are the changes service and a dedicated inbox submission service with separate capabilities.

The port must enforce canonical path validation, file-kind restrictions, expected-content/version checks, and no control-file targets for research or inbox operations. A distinct local setup capability may create only missing configured control files after exact-content approval; it cannot update them. The adapter uses Obsidian-supported writes with a compare-before-update strategy verified against the current editor/disk state. If a reliable check cannot be made, refuse to apply rather than overwrite. There is no general write/delete/rename API exposed to features or MCP clients.

`check-no-writes.mjs` permits only `vault.create` and `vault.process` in the named note adapter. Delete, rename, folder creation and raw adapter writes remain forbidden there; integration tests enforce the approved call path. StoragePort is never widened into a vault writer. Navigation remains read-only.

### 2.3 Network and MCP boundary

Provider network APIs exist only in allowlisted transport adapters. Bonsai allows HTTP numeric 127.0.0.1 only, with fixed inference/health routes, no credentials/query/fragment, no DNS aliases or redirects. Existing Node HTTP transport enforces endpoint policy and does not follow redirects. OpenRouter retains its host allowlist. MCP introduces an explicitly allowlisted local server adapter with authentication and connection lifecycle. It does not add arbitrary outbound hosts. No feature uses bare fetch, filesystem APIs, or sockets.

R4-T01 selects authenticated IPv4 loopback Streamable HTTP with manually provisioned per-client bearer grants. The [MCP v1 contract](docs/contracts/mcp-v1.md) freezes transport version, strict semantic schemas, safe references, revocation, limits and lifecycle requirements. Provider credentials are never client credentials and are never exposed to clients. The [runtime adapter](docs/r4-t02-mcp-adapter-audit.md) now provides opt-in local pairing and lifecycle controls; the [collaboration facade](docs/r4-t03-collaboration-audit.md) provides intersected recipient queries with extractive answers and serialized, journaled inbox submission.

## 3. Contracts and model outputs

Preserve existing VaultPath, Result, Transport, ModelPort, Clock, Logger, and JobQueue contracts where compatible. Cleanup removes PDF contracts and unused contradiction/relevance schemas after callers and test coverage are audited.

New contracts are specified before implementation:

- `AccessContext`: recipient (`internal`, `remote-model`, `external-client`), purpose, authenticated client ID/scopes, and policy version.
- `PolicySnapshot`: implementation-owned fixed access contract plus version hash. Runtime access combines exclusions, operation restrictions and authenticated client capabilities; no vault policy is loaded.
- `InstructionSnapshot`: formatting prose/examples, validated routing configuration, timezone, and version/content hash.
- `ResearchBatch`: stable ID, selected source range/hash, provenance, and processing state.
- `ChangeProposal`: ID, batch hash, instruction/policy versions, target IDs, operation (`create`/`update`), complete before/after text, target hashes, evidence IDs, and validation issues.
- `Approval`: local-UI-issued single-use binding to the exact selected proposal and its snapshots. No model or MCP field can constitute approval.
- `ApplyReport`: per-file applied/conflicted/failed outcome plus recovery-record ID.

Model responses are Zod-validated structured objects with provider subset-compatible schemas. Health uses the production request builder. Retrieval/answer models return bounded terms, enums, booleans, answer text and ledger IDs. Proposal models may return bounded Markdown content and destination IDs. They never supply trusted paths, executable commands, regex, security grants, approval tokens, or source quotes. Model text is untrusted even when its JSON is valid.

The plugin constructs citation text from verified evidence. Routing maps IDs to canonical destinations; for new notes, the plugin constructs a path from validated templates and bounded input such as a resolved date.

## 4. Control files and precedence

Defaults: `Synapse/Instructions.md` and `Research.md`. Paths are configurable, canonical and distinct. Both are excluded from ordinary retrieval; research may explicitly read selected inbox material and instructions. Setup proposes the instruction starter without overwriting existing files.

The 2026-10-17 user revision removes Security.md, its loader, template, path setting and user-authored recipient grants/masks. Search/chat require no control files. A fixed implementation-owned access contract supplies the existing read-session and approval interfaces. It permits non-excluded content for the selected provider, scoped MCP queries/submissions, and locally reviewed create/update operations. Exclusions, provider consent, MCP authentication/scopes and exact diff approval remain independent gates. Old security-path settings are dropped; vault files are never migrated or deleted.

Instructions.md contains versioned routing settings and free-form style examples. Routing is deterministic; model generation follows the style within permitted destinations. The daily-note rule uses the user-configured timezone and rejects ambiguous dates. Instructions.md cannot be rewritten by the assistant; its edits invalidate dependent proposals and pending disclosures.

### 4.1 Frozen version 1 contracts

The active contracts retain canonical instruction/inbox paths, recipient/capability contexts, daily routing and SHA-256 approval bindings. The access snapshot is fixed in code; its hash versions the implementation contract rather than vault policy text. Existing low-level rule/projection helpers remain internal compatibility infrastructure, with no file or settings entry point.

## 5. Runtime workflows

### 5.1 Search/chat

Snapshot current access context → bounded model plan → deterministic tool search → evidence selection/read → answer → citation verification. Support follow-up retrieval when evidence is insufficient; all transitions share one hop/token/time/read budget and duplicate-call tracker. The existing Q&A pipeline is reused, then audited to prove iterative retrieval. Tool inputs/outputs, graph neighbors, traces, prompt construction, and final results all filter under current permissions.

OpenRouter planning has no client-imposed output token cap: omit OpenRouter `max_tokens`
for `qa.plan`, including schema retries. Plan structure remains schema-bounded;
queue cancellation, transport timeouts and run hop/time/read budgets still apply.
Selection and answer requests retain their configured output token limits.

Only current allowed evidence enters the ledger. Before each model request, recheck exclusions, provider consent and context freshness. On source, instruction or settings changes, discard stale evidence and responses. User chat and MCP queries have separate access contexts; an internal answer cannot simply be forwarded externally.

### 5.2 Research proposals

R3-T01 implements local selected inbox capture, exact source/selection snapshots and an approval-free durable processing ledger. Stable content identity is separate from source freshness; malformed or conflicting history fails closed. Current behavior and interfaces are recorded in [research capture audit](docs/r3-t01-research-audit.md). Proposal generation and application remain subsequent tasks.

The user selects an inbox batch → snapshot research/instructions/policy → retrieve permitted target context → schema-constrained generation → deterministic validation → immutable proposal → full diff in local review UI. Unresolved routing or provenance issues prevent approval.

R3-T03 connects selected research to explicit destination/date choices and complete literal before/after review. Local approvals remain in memory, bind only accepted changes and are revoked by edits, settings changes, cancellation or unload. Stale review text is removed. That milestone included no application or vault-write checker changes. The service boundary and verification are recorded in [review audit](docs/r3-t03-review-audit.md).

R3-T04 adds an explicit Apply action, atomic compare-before-update through `Vault.process`, absent-only creation and checks of all open Markdown editor buffers. A conservative batch-attempt marker is flushed before writing; R3-T05 adds bounded per-file intent/outcome recovery and fresh local revert review. See the [recovery audit](docs/r3-t05-recovery-audit.md). The scoped append capability is uncomposed until authenticated MCP submission. See the [application audit](docs/r3-t04-apply-audit.md).

The UI lets the user accept/reject individual changes and approve the selected batch. Editing generated text produces a new proposal/diff. Apply revalidates approval, source/target hashes, unsaved buffers, and current policy/instructions before each write. A conflict invalidates the affected proposal and requires a new review. Research is preserved; a batch ledger records applied changes without treating inbox content as policy.

### 5.3 Apply/recovery

Write durable intent/recovery metadata before each operation; bind it to the exact approved change. Recheck expected file state through the write adapter, then record success. On restart, reconcile pending records with current content; do not blindly reapply. Multi-file writes are sequential and explicitly non-atomic. Record and report partial success. Revert is a new version-checked proposal requiring approval.

Proposal/recovery persistence may contain note text. Keep it in the plugin folder with bounded retention, clear-data behavior, and explicit sync/privacy disclosure. No prompt or note-content logging is permitted.

### 5.4 MCP

Initial semantic operations: `query_vault` (bounded question, policy-filtered answer/safe citations) and `submit_research` (bounded append, source metadata, idempotency key). Names/contracts are frozen in the MCP design task. No arbitrary paths, raw vault resources, unrestricted search listings, approval/apply tool, or control-file edits.

Authenticate → check current capabilities/policy → validate bounded input → execute through the appropriate facade/queue → recheck before delivery/append. Generic denials avoid revealing a forbidden note's existence. References use safe labels/opaque handles unless the path itself is shareable. All excerpts, titles, identifiers, errors, counts and traces obey disclosure rules. Repeated inbox submissions with the same idempotency key do not duplicate research.

An explicitly enabled inbox-submit capability authorizes appending only to Research.md. Serialize appends with local inbox activity and reject stale/conflicting writes. It never authorizes changes to destination notes.

## 6. State, errors, and UI

One ModelPort lane through JobQueue: user search/chat > user research proposal > MCP model work, with bounded fairness to avoid indefinite starvation. No daily model jobs are scheduled in the current plan. Network/apply cancellations cannot commit late results; non-abortable transport responses are ignored after cancellation.

UI uses pure immutable viewmodels and textContent/safe DOM rendering. CSS uses `.syn-`; strings live in `ui/strings/`; identity and tunables in constants/settings. Review panes display literal Markdown diffs, full target names to the local user, provenance, conflicts, and per-file application results.

Persist only necessary state: settings, research batch/idempotency ledger, approval-free recovery records, and optional bounded proposal cache. No API keys, prompts, research, or note bodies in diagnostics. Path logs use `h:` plus eight hex characters of SHA-1. Clearing plugin data keeps settings and all user vault files.

## 7. Implementation migration

Existing code provides OpenRouter runtime, job queue, exclusions, Markdown corpus/tools, evidence, sidebar chat, and Markdown citation navigation. Automated host tests are not proof of real Obsidian UI behavior.

R1-T01 removed obsolete PDF probe/build fixtures and PDF/contradiction scaffolding across ports, schemas, config/state, strings, boundaries, tests, and docs, along with unused resurfacing schemas, settings, and state. Search/chat and meaningful privacy/citation tests remain; legacy data is normalized without reviving retired feature state. See docs/r1-cleanup-audit.md for the reference audit and verification. Historical snapshots are not implementation requirements. Repo `research.md` (prior engineering research) is distinct from the user's vault `Research.md` inbox.

## 8. Security invariants

1. Excluded notes never enter the ordinary corpus, tools, or model context.
2. Recipient permission is checked before context construction and again before delivery; internal access is not external access.
3. No approval, security setting, or destination path is trusted because it appears in model output, research, or an MCP request.
4. Only the dedicated write adapter can create/update user Markdown, and only with a valid local approval or scoped inbox append capability; the separate approved setup capability only creates missing starter control files.
5. External clients cannot approve note changes, edit control files, or access provider credentials.
6. Policy uncertainty fails closed for external sharing and writes. Prompt-only guardrails are insufficient.

## 9. Verification and delivery

### 9.1 Test layers

Unit tests for policies/routing/budgets/proposals; shared contracts for fakes and adapters; integration tests for recipient filtering, provider payloads, stale approval, write conflicts, partial recovery, MCP scopes, injection, revocation and unload. Synthetic evals measure known-answer correctness, citation validity, schema success, privacy violations and latency. Live default calls use the production Bonsai integration with synthetic inputs; optional cloud checks remain separately opt-in.

### 9.2 Manual evidence

Real Obsidian: load/unload, search/chat, exact passage navigation, create/update diffs, cancel/reject, editing during review, inbox submissions from an MCP client, and policy denial/masking. Record operator observations; never describe a mock-host smoke as a real-vault validation.

### 9.3 CI

Typecheck → lint → boundaries → tests → privacy/network/write/schema checks → build. Update strict allowlists only for named required adapters with equivalent behavioral tests.

### 9.4 Definition of done

SPEC acceptance criteria met, required tests/checks/build green, architecture and privacy invariants preserved, manual plugin behavior evidenced where required, and task status updated only in PLAN.md. Documentation changes alone do not complete implementation features.

## 10. Decisions

- ADR-21 superseded by ADR-26 (user revision 2026-10-17): Bonsai 2 4B PQ2_0 via Prism llama.cpp default now; OpenRouter explicit only. No Ollama substitution.
- ADR-22: Markdown-only release; remove PDFs/page citations and contradiction finding.
- ADR-23: User-reviewed note creation/update via a dedicated restricted write port, superseding the old absolute no-note-editing rule.
- ADR-24 (revised 2026-10-17): Editable formatting instructions; Security.md removed in favor of fixed boundaries, exclusions, client scopes and local approval.
- ADR-25: External research agents use scoped authenticated MCP through Synapse; research is untrusted and local UI owns approval.

## 11. Out of scope

See SPEC §6. Bonsai integration is authorized now; full local quality and real-host release validation remain required. Daily resurfacing is outside the current release scope.

## 12. Bonsai integration (ADR-26)

`BonsaiClient` implements ModelPort using the shared OpenAI-compatible completion validator/cancellation/freshness machinery. One Bonsai builder supplies schema-constrained decoding and Prism's small-model non-thinking sampling profile explicitly. Bonsai caps every completion (including planning) at 1,024 tokens, retaining smaller caller limits; Zod validates all results and permits one schema retry. The local configuration uses 4,096 server context and one slot; settings do not resize the server. See docs/bonsai.md for compatibility and measured limitations.

Composition selects Bonsai and Node HTTP transport without reading/passing cloud credentials. Health probes /health and runs the same production builder through JobQueue. Plugin load never starts a process or downloads weights. Settings migration moves legacy cloud defaults to local, preserving unrelated configuration and credentials; providerRevision=1 preserves subsequent explicit cloud selection. Custom cloud configurations remain explicit selections. No runtime failure changes providers.

Access revision: Bonsai and explicitly selected OpenRouter use the fixed access contract. No Security.md grants or masks are loaded. MCP still requires local authentication and independent scopes.

## 12. Required retrieval metadata (R8-T01)

The bounded contract and strict YAML parser live in `core/note-metadata.ts`; `NOTE_METADATA_LIMITS` is shared by runtime validation, compact tool projections and the `metadata.propose` Zod/provider schema. YAML is the existing pure parser dependency (the core boundary explicitly permits it); no runtime I/O, executable YAML or Dataview is added. Frontmatter is capped at 16,384 characters; aliases expand at most 32 times. Blank/null/nonlist fields fail closed. Semantic relevance and stale descriptions need human judgment.

CorpusStore evaluates existing exclusion rules before any body read. It parses each eligible original, keeps valid DocMeta/frontmatter plus existing text/title-alias/tag/link indexes, and maintains a separate local-only path/issue repair map. All normal reader/index/graph surfaces omit invalid notes. Source/metadata events remove the old document before asynchronous re-ingest; per-path revisions discard superseded reads. A failed read becomes a repair issue. Repair maps/counts are not injected into tools, model prompts or MCP. Status forwarding includes attention counts. Missing metadata-cache entries remain fail-closed while the host parses them.

Reuse the folded body index for body matches, TitleIndex for aliases and TagIndex for tags. `search_text` additionally matches the bounded DocMeta description/aliases/tags; metadata-only matches yield a bounded opening body excerpt, never a frontmatter excerpt. Candidate metadata is clipped to the product bounds. Title/tag-only searches perform bounded `read_note` hops before evidence selection. Search/read excerpt offsets remain full-file offsets, but the frontmatter region cannot mint citations. Misleading metadata can select irrelevant bodies, which must produce no unsupported factual answer. Existing hop/read/model/context/time limits and current-access checks remain enforced.

`research/metadata-repair.ts` exposes a local ephemeral capability, composed into the **Review note metadata** DOM view. It has no MCP entry point and does not require Research.md or Instructions.md. One research-priority JobQueue job generates at most 512 output tokens from a note of at most 6,000 characters. Only absent fields are inserted as JSON-compatible YAML directly before the existing closing fence; existing YAML/body bytes are preserved. Malformed/incomplete existing values require manual repair. No large-note truncation is sent to a model: oversized notes need manual repair to avoid inventing incomplete descriptions.

The existing ReviewApproval authority accepts an explicitly injected repair target/source (one update only); external/model serialized data does not select that mode. Approval hashes the exact proposal and is identity-checked, single-use and revalidated at consumption. The repair service binds target contents, active editor, instruction availability/content when readable, provider/settings/access generation, all vault/metadata events and cancellation. Configured excluded instructions are never read by migration. NoteWritePort rechecks all open target editors and compare-before-process, and enforces valid resulting metadata for ordinary creates/updates. Inbox append retains its separate exemption. The repair UI shows complete inert before/after text using textContent, with separate Approve and Apply actions. It never replaces an existing field. Repair proposals are ephemeral; this first migration workflow has no plugin recovery/revert journal. Unknown write outcomes explicitly require inspecting the note and re-auditing; there is no automatic retry. Research journal/revert behavior remains separately governed by R3-T05, and a revert to invalid metadata cannot be approved/applied.

Research output validates only the resulting complete note, so a missing-field original can be repaired. New daily output supplies frontmatter plus a list entry; the plugin constructs the routed heading. Existing daily entries preserve frontmatter and must already yield a valid resulting note. Generic research replacements reject changes to any existing frontmatter value. The automatic audit validates raw YAML; provider response schemas additionally bound output before runtime contract checks.

Evidence: [metadata evaluation](docs/metadata-evaluation.md). Headless and narrow live checks do not close Obsidian UI/editor/MCP release gates.
