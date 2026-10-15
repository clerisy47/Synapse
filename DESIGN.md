# DESIGN: Synapse

Status: draft v2 · Revised 2026-10-14 · Binding input: SPEC.md v2.
This is the target architecture, not a claim that planned features already exist. The previous detailed design is historical under `docs/history/2026-10-14-scope-revision/`.

## 1. Product and provider phases

Markdown agentic search, cited vault chat, instruction-guided research-to-note proposals, and policy-controlled MCP collaboration. Phase A uses OpenRouter `openrouter/free`; Phase B adds and defaults to local Ollama only after all Must + Should features are complete. Selected permitted context goes to OpenRouter during Phase A. No embeddings, vector DB, telemetry, PDFs, contradiction finding, or daily resurfacing.

## 2. Architecture

### 2.1 Layers

Ports-and-adapters with a plain strict TypeScript core. `main.ts` constructs dependencies and registers lifecycle only. Features contain no Obsidian, Node, or Electron APIs. Only `adapters/obsidian` and `adapters/node` import those runtimes. Every module exports through `index.ts`; imports across modules use that facade.

| Layer/module | Responsibility and permitted dependencies |
|---|---|
| core | Branded paths, Result/errors, port contracts, clock/logger; no other modules. |
| config, state, evidence, jobs, llm | Core services; core and injected contracts. |
| policy | Deterministic exclusions, recipient access, masking, write authorization; core. |
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

`check-no-writes.mjs` retains the current blanket ban until NoteWritePort is implemented. Then add only the named adapter to its allowlist and enforce approved-call-path contracts with integration tests. StoragePort is never widened into a vault writer. Navigation remains read-only.

### 2.3 Network and MCP boundary

Provider network APIs exist only in allowlisted transport adapters. Phase A egress is OpenRouter API hosts only; Phase B adds loopback Ollama. MCP introduces an explicitly allowlisted local server adapter with authentication and connection lifecycle. It does not add arbitrary outbound hosts. No feature uses bare fetch, filesystem APIs, or sockets.

The MCP transport selection is a dedicated design task. Choose a supported local transport with per-client capabilities and revocation; test authentication, origin/host restrictions where relevant, request bounds, and unload cleanup. Provider credentials are never client credentials and are never exposed to clients.

## 3. Contracts and model outputs

Preserve existing VaultPath, Result, Transport, ModelPort, Clock, Logger, and JobQueue contracts where compatible. Cleanup removes PDF contracts and unused contradiction/relevance schemas after callers and test coverage are audited.

New contracts are specified before implementation:

- `AccessContext`: recipient (`internal`, `remote-model`, `external-client`), purpose, authenticated client ID/scopes, and policy version.
- `PolicySnapshot`: validated structured rules plus version/content hash. Decision is allow, mask, or deny. Effective permissions are the intersection of exclusions, operation permissions, recipient rules, and client capabilities.
- `InstructionSnapshot`: formatting prose/examples, validated routing configuration, timezone, and version/content hash.
- `ResearchBatch`: stable ID, selected source range/hash, provenance, and processing state.
- `ChangeProposal`: ID, batch hash, instruction/policy versions, target IDs, operation (`create`/`update`), complete before/after text, target hashes, evidence IDs, and validation issues.
- `Approval`: local-UI-issued single-use binding to the exact selected proposal and its snapshots. No model or MCP field can constitute approval.
- `ApplyReport`: per-file applied/conflicted/failed outcome plus recovery-record ID.

Model responses are Zod-validated structured objects with provider subset-compatible schemas. Health uses the production request builder. Retrieval/answer models return bounded terms, enums, booleans, answer text and ledger IDs. Proposal models may return bounded Markdown content and destination IDs. They never supply trusted paths, executable commands, regex, security grants, approval tokens, or source quotes. Model text is untrusted even when its JSON is valid.

The plugin constructs citation text from verified evidence. Routing maps IDs to canonical destinations; for new notes, the plugin constructs a path from validated templates and bounded input such as a resolved date.

## 4. Control files and precedence

Defaults: `Synapse/Instructions.md`, `Synapse/Security.md`, and `Research.md`. Paths are configurable and normalized, cannot escape the vault, and must not collide. These files are excluded from normal retrieval/disclosure, with explicit privileged reads by their loaders. Setup proposes starter files rather than overwriting anything.

Security.md uses schema-validated frontmatter for enforceable rules and Markdown prose for explanations. Missing/invalid policy disables MCP operations and note application. Deny wins over allow. Formatting prose and research never loosen security. Rules distinguish indexing/internal reads from remote-provider egress, external disclosure, and note writes. Mask rules are deterministic structured field removals or literal replacements. A model cannot certify that arbitrary sensitive information was completely removed.

Instructions.md contains versioned routing settings and free-form style examples. Routing is deterministic; model generation follows the style within permitted destinations. The daily-note rule uses the user-configured timezone and rejects ambiguous dates. Security.md cannot be rewritten by the assistant; edits to either control file invalidate dependent proposals and pending disclosures.

### 4.1 Frozen version 1 contracts

R2-T01 defines strict control schemas, canonical paths, recipient/capability decisions, daily routing and SHA-256 approval bindings. The repository starter permits internal reads only; remote/client reads and all writes require explicit policy permission. Full wire shapes, precedence, bounds, diagnostics, templates and later runtime responsibilities are frozen in [control contracts](docs/control-contracts.md). Templates are assets only. Local contract schemas do not change provider-output schemas or enable runtime writes/network. Shared control tunables live in constants; policy, instructions and changes may import those constants alongside their layer dependencies.

## 5. Runtime workflows

### 5.1 Search/chat

Snapshot current access context → bounded model plan → deterministic tool search → evidence selection/read → answer → citation verification. Support follow-up retrieval when evidence is insufficient; all transitions share one hop/token/time/read budget and duplicate-call tracker. The existing Q&A pipeline is reused, then audited to prove iterative retrieval. Tool inputs/outputs, graph neighbors, traces, prompt construction, and final results all filter under current permissions.

Only current allowed evidence enters the ledger. Before each remote request, apply egress checks and masking to context and history. On policy changes, discard stale evidence and responses. User chat and MCP queries have separate access contexts; an internal answer cannot simply be forwarded externally.

### 5.2 Research proposals

R3-T01 implements local selected inbox capture, exact source/selection snapshots and an approval-free durable processing ledger. Stable content identity is separate from source freshness; malformed or conflicting history fails closed. Current behavior and interfaces are recorded in [research capture audit](docs/r3-t01-research-audit.md). Proposal generation and application remain subsequent tasks.

The user selects an inbox batch → snapshot research/instructions/policy → retrieve permitted target context → schema-constrained generation → deterministic validation → immutable proposal → full diff in local review UI. Unresolved routing or provenance issues prevent approval.

R3-T03 connects selected research to explicit destination/date choices and complete literal before/after review. Local approvals remain in memory, bind only accepted changes and are revoked by edits, settings changes, cancellation or unload. Stale review text is removed. No application or vault-write checker changes are included. The service boundary and verification are recorded in [review audit](docs/r3-t03-review-audit.md).

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

Unit tests for policies/routing/budgets/proposals; shared contracts for fakes and adapters; integration tests for recipient filtering, provider payloads, stale approval, write conflicts, partial recovery, MCP scopes, injection, revocation and unload. Synthetic evals measure known-answer correctness, citation validity, schema success, privacy violations and latency. Live Phase A calls use openrouter/free only; Phase B evals wait until feature completion.

### 9.2 Manual evidence

Real Obsidian: load/unload, search/chat, exact passage navigation, create/update diffs, cancel/reject, editing during review, inbox submissions from an MCP client, and policy denial/masking. Record operator observations; never describe a mock-host smoke as a real-vault validation.

### 9.3 CI

Typecheck → lint → boundaries → tests → privacy/network/write/schema checks → build. Update strict allowlists only for named required adapters with equivalent behavioral tests.

### 9.4 Definition of done

SPEC acceptance criteria met, required tests/checks/build green, architecture and privacy invariants preserved, manual plugin behavior evidenced where required, and task status updated only in PLAN.md. Documentation changes alone do not complete implementation features.

## 10. Decisions

- ADR-21 retained: OpenRouter-first feature completion, then local Ollama.
- ADR-22: Markdown-only release; remove PDFs/page citations and contradiction finding.
- ADR-23: User-reviewed note creation/update via a dedicated restricted write port, superseding the old absolute no-note-editing rule.
- ADR-24: In-vault editable formatting/security files; structured policy enforcement rather than prompt-only permissions.
- ADR-25: External research agents use scoped authenticated MCP through Synapse; research is untrusted and local UI owns approval.

## 11. Out of scope

See SPEC §6. Local inference validation is a final Phase B milestone. Daily resurfacing is outside the current release scope.
