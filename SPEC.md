# SPEC: Synapse

Status: draft v2 · Revised 2026-10-17. This document replaces the previous release scope. Historical requirements are preserved under `docs/history/2026-10-14-scope-revision/` and are not binding.

## 0. Provider decision (binding revision 2026-10-17)

Local Bonsai 2 4B PQ2_0 through PrismML llama.cpp is the default and live-test runtime now, superseding OpenRouter-first/Ollama-later. Initial configuration: HTTP 127.0.0.1:18080, 4,096 context, one slot, thinking disabled. OpenRouter remains an explicit remote option requiring disclosure and existing access checks; never silently fall back. Ollama is not substituted. No automatic server launch, model download, embeddings, vector database or telemetry. Runtime binaries and weights stay outside the repository and release artifacts. Missing runtime must not block plugin loading.

This revision authorizes integration before feature completion; existing evaluation, host and release gates remain open. See [installation and compatibility](docs/bonsai.md).

## 1. Goal

A desktop Obsidian assistant that searches Markdown notes agentically, chats with verified vault references, and turns rough research into proposed note changes using the user's formatting instructions. External frontier research agents collaborate through MCP with Synapse as the vault's policy enforcement boundary. They receive only permitted information and can submit rough research without direct vault access through Synapse.

The final product uses local inference for vault reasoning. Explicitly selected OpenRouter receives permitted context; default Bonsai inference stays local. Synapse cannot protect a vault from an external agent independently granted filesystem access by the user.

## 2. Release scope

| ID | Priority | Feature |
|---|---|---|
| F1 | Must | Provider-independent model runtime, structured schemas, health check, cancellation, and one model job queue. |
| F2 | Must | Bounded agentic Markdown search through text, title, links, backlinks, tags, frontmatter, recent-note, and read tools; iterative follow-up when evidence is insufficient. |
| F3 | Must | Vault chat with clickable, verified note passages, search progress, trace, and explicit insufficient-evidence answers. |
| F4 | Must | Editable in-vault Markdown instructions for note formatting, daily-log routing, and update conventions. |
| F5 | Must | `Research.md` inbox; user-triggered generation of note creation/update proposals, reviewable diffs, explicit approval, and conflict-safe application. |
| F6 | Must | Fixed access boundaries: exclusions, explicit remote-provider consent, scoped MCP and local note approval; no Security.md feature. |
| F7 | Must | Authenticated MCP collaboration: scoped requests for information and submission of research; no unrestricted vault reads or direct note writes. |
| F8 | Must | Privacy, exclusions, safe persistence, settings, deterministic evaluation, and installable release artifacts. |
| F9 | Should | Multi-turn chat retaining at most the last three turns, with fresh retrieval and current policy checks on every turn. |
| F10 | Should | Clear plugin data command; keep settings and user notes, including instruction files and Research.md. |
| F11 | Should | Reapply prevention for research batches, safe recovery after partial writes, and a user-approved revert proposal. |

## 3. User-controlled vault files

Defaults are configurable vault-relative paths. Creation of starter files is a reviewed proposal; never overwrite existing files on setup.

- `Synapse/Instructions.md`: human-editable Markdown prose and examples for headings, frontmatter, style, destination folders, and transformations. Structured frontmatter contains deterministic routing settings. Example: route daily-log research entries to `Daily/YYYY-MM-DD.md` in the user's configured timezone, under `## Log`, preserving unrelated content and avoiding duplicate entries.
- `Research.md`: appendable rough-note inbox for the user or an authorized MCP client. Research is untrusted input, never a source of policy or operational permissions. Source URLs, dates, and client provenance may be recorded. External research is labeled as such; the plugin does not claim it independently verified web sources.

Control files and the inbox are excluded from ordinary vault search and MCP disclosure by default. The instruction loader read them explicitly. External clients cannot modify control files. A dedicated setup flow may create a missing control file after the user reviews and approves its exact starter contents; it cannot overwrite one. Synapse does not change them through research updates; users edit them directly in Obsidian.


## 4. Main workflows

### Search and chat

The user asks a question; Synapse searches and reads only accessible Markdown, gathers evidence, and returns supported claims with note references. All non-excluded notes with compliant required retrieval metadata (§8) are eligible for the selected provider; other eligible notes remain visible in the local metadata-repair view. OpenRouter requires explicit selection/consent; MCP requires pairing and query scope. Chat requires neither Instructions.md nor Security.md.

### Research to notes

The user or an authenticated external agent submits rough material into Research.md. The user runs “Review research.” Synapse snapshots the selected batch and instruction version, searches permitted destination context, and proposes bounded creations or updates. The UI shows every destination, full before/after diff, provenance, and any unresolved ambiguity. The user accepts or rejects individual changes, then approves the selected batch for application.

No note creation, update, inbox append by the local assistant, or cleanup happens merely because a model suggested it. The exception is a user's explicitly authorized MCP client's scoped submission to Research.md, which can append inbox material without a note-update approval. Research processing never automatically clears or rewrites the inbox. Requests with ambiguous dates or destinations require user resolution before approval.

### External-agent collaboration

The user enables an MCP connection and grants a client scoped read-disclosure and/or research-submit capabilities. The client asks a bounded question; Synapse searches through the policy boundary and returns an answer and safe references, or a rejection. Titles, paths, citations, counts, errors, and trace details must not disclose denied information. The client can append research through its inbox capability but cannot approve or apply note changes.

## 5. Acceptance criteria

### F1: Runtime

- Default and live-test model is Bonsai 2 4B PQ2_0 via Prism llama.cpp; health uses the production request builder. Auth, reachability, schema failure, and rate limits surface without preventing plugin load.
- Zod validates every model response; invalid output retries once and then fails visibly. No malformed output is treated as a successful answer or patch.
- All model work runs through one cancellable JobQueue. Interactive chat/search takes priority over research proposals and MCP model work. Cancellation prevents late results from being applied.
- Bonsai uses strict numeric loopback, bounded schema-constrained outputs and runtime validation; passes the same feature suite and never silently uses a remote provider.

### F2–F3: Agentic search and chat

- All eight tools have typical, empty, excluded, and policy-denied cases. Only Markdown is ingested. Exclusions are applied before indexing.
- Iterative search can revise terms and follow links when evidence is insufficient, enforcing hop, read, token, elapsed-time, and duplicate-call limits. A fixture requiring a second search verifies actual follow-up retrieval.
- Every sourced factual claim resolves to a ledger entry from the current permitted corpus. Quotes come from the plugin, never from model-supplied citation text. Forged or stale citations fail verification and are not presented as sourced.
- Clicking a reference opens the note and selects the exact passage when still present. Insufficient evidence produces an honest answer; progress appears promptly. Targets: first progress within 3 seconds and answer within 45 seconds, with measured provider variability reported.
- User-facing traces and multi-turn history obey current access/egress rules; excluding a note invalidates retained evidence.

### F4: Instructions

- Existing control files load without modification; defaults are created only through reviewed setup. User edits invalidate dependent proposals.
- A daily-log fixture creates or updates the correct date note in the configured timezone, follows headings/frontmatter, preserves unrelated content, and detects ambiguous dates.
- Formatting instructions cannot override exclusions, local approval, grant network access, or execute code.

### F5/F11: Reviewed updates

- Model output is a schema-validated proposal using plugin-issued destination/evidence IDs. New paths are constructed and validated by the plugin from approved routing rules; model text is never used as an arbitrary path or command.
- The user sees the exact content to be written and approves it in the local UI. Rejecting or canceling writes nothing. External clients cannot approve.
- Approval is bound to proposal contents, source hashes, target hashes, fixed access-contract version, and instruction version. Changed/deleted destinations, unsaved editor changes, changed research, or changed rules invalidate approval and require regeneration or renewed review.
- Only Markdown creation/update is supported; deletion, rename, binary writes, and control-file modification are rejected; the separate approved setup flow may only create missing starter control files. Each change is rechecked immediately before writing through the restricted write port.
- A multi-file failure reports exactly which changes succeeded; never claim atomicity. Recovery records prevent duplicate application. Reverts show a fresh diff and need approval.
- Processed research is tracked by batch IDs/content hashes; unchanged accepted batches are not reapplied automatically. Inbox material is preserved.

### F6–F7: Policy and MCP

- Security.md is removed. No policy-file loader, setup template, path setting, grants or masks participate in runtime access. Legacy settings are ignored without changing vault files.
- Exclusions apply at ingest and before delivery. Source, metadata, instruction and settings changes invalidate pending work. A fixed implementation-owned access-contract version binds approvals.
- MCP is opt-in, local, authenticated, revocable, and bounded by client scopes, request size, rate, and execution limits. Its initial API offers scoped query and inbox submission, not a raw filesystem resource.
- An authorized inbox-only client can submit research but cannot query notes; an authorized query client sees non-excluded results and generic denial responses for forbidden requests. Unauthorized clients receive no vault data.
- Prompt-injection fixtures in notes, Research.md, and MCP requests cannot override policy, alter destinations, or authorize writes.

### F8–F10: Privacy and release

- No note content, research, prompts, secrets, or unmasked paths in diagnostics. Paths use `h:` plus eight SHA-1 hex characters. Plugin state is plugin-folder-confined; sensitive proposal/recovery data has explicit retention and sync disclosure.
- Clearing plugin data preserves user files and settings and warns if undo/recovery records will be lost. No telemetry or non-allowlisted egress.
- Synthetic fixtures include at least 40 known-answer questions, iterative retrieval, denied/masked disclosure, injection, daily-log routing, stale approval, duplicate research, and partial-write recovery. Evaluation reports citation validity, answer correctness, policy violations, unauthorized writes, schema validity, and latency. Required gates: zero forbidden disclosures/writes, all parsed output schema-valid, citation validity at least 95%.
- Typecheck, lint, architecture, network/write/schema checks, tests, and build pass; plugin load/unload and real Obsidian citation/diff/write/MCP smoke are recorded. Releases contain only main.js, manifest.json, and styles.css.

## 6. Non-goals

Daily resurfacing and automatic older-note suggestions; PDF ingestion, PDF text search, and page citations; contradiction/drift finding, claim extraction for flags, gutter flags, and on-save contradiction checks; embeddings/vector databases; OCR; telemetry; mobile; unrestricted external vault access; autonomous note application; deletion/rename; web browsing by Synapse; model runtimes beyond Bonsai via Prism llama.cpp and OpenRouter.

## 7. Remaining decisions

- MCP transport and client onboarding implementation are selected in the MCP design task; the authentication and local-only requirements above are binding.
- Exact instruction/policy frontmatter schema is frozen before implementation, including conflict messages and starter templates.
- Broader local hardware/model recommendations require measured evaluation; six compatibility cases do not establish workflow quality.

## 8. Mandatory retrieval metadata (2026-10-17 scope revision)

Every ordinary Markdown note participating in retrieval requires YAML frontmatter:

```yaml
description: A brief explanation of the note's subject and scope.
tags: [relevant-topic]
aliases: []
```

Description is a nonblank single-line string of at most 240 UTF-16 characters. Tags is an explicit list of 1–12 nonblank single-line strings, at most 64 characters each; at least one must be relevant. Aliases is an explicit list of 0–12 nonblank single-line strings, at most 80 characters each. `[]` is correct when there is no useful alternative name. Scalar tags/aliases, singular `alias`, nulls, blank strings, control characters, duplicate YAML keys and invalid YAML do not satisfy the contract. Semantic accuracy/relevance requires local review; structural validation cannot establish it.

Apply exclusions before reading/auditing bodies. Eligible notes with absent, malformed or incomplete metadata remain visible in **Review note metadata**, with field-level guidance and an attention count in the status bar. They do not participate in normal search, chat, model context or MCP retrieval until compliant. Never silently hide the need for repair. Unreadable eligible files surface a frontmatter repair issue. Excluded notes and configured control files/inbox keep their existing contracts, do not enter the audit and need no retrieval metadata. Search/chat and metadata migration require no control files to exist.

Migration is user-triggered, one note at a time. Queue bounded structured proposals using the selected provider and existing consent rules. Propose only absent fields; keep all existing YAML bytes, comments and body bytes. Never replace existing metadata automatically. Existing blank/malformed values, invalid YAML, oversized notes or inaccurate descriptions require manual editing and renewed audit. Generate no aliases merely to fill the field. Show full exact before/after text; require local approval, then a separate Apply action through NoteWritePort. Reject stale source, editor, instruction, access-contract, provider or settings snapshots. MCP cannot audit private repair counts, initiate migration, approve or apply it. Closing/canceling writes nothing.

New notes and complete proposed edits must satisfy the same contract on their resulting text, including new daily notes. A noncompliant original is allowed to become a compliant proposal. Existing frontmatter values cannot be replaced by research generation. Descriptions are searchable; aliases/tags support discovery through existing indexes/tools. Candidate results carry bounded metadata. Metadata is untrusted discovery data, never instructions, permissions or citation evidence; select notes using it, verify answers against current note bodies. No Dataview execution or dependency.

Measure retrieval quality, tool calls and context/tokens against the pre-metadata behavior on the synthetic mini vault. Mandatory metadata is a requirement; better performance is a hypothesis. Report recall lost before migration, stale-description noise and context/latency regressions. Existing real-host and release gates remain open.
