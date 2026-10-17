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
| F6 | Must | Editable in-vault security policy enforcing internal access, remote-provider access, external-agent disclosure, masking, and rejection. |
| F7 | Must | Authenticated MCP collaboration: scoped requests for information and submission of research; no unrestricted vault reads or direct note writes. |
| F8 | Must | Privacy, exclusions, safe persistence, settings, deterministic evaluation, and installable release artifacts. |
| F9 | Should | Multi-turn chat retaining at most the last three turns, with fresh retrieval and current policy checks on every turn. |
| F10 | Should | Clear plugin data command; keep settings and user notes, including instruction files and Research.md. |
| F11 | Should | Reapply prevention for research batches, safe recovery after partial writes, and a user-approved revert proposal. |

## 3. User-controlled vault files

Defaults are configurable vault-relative paths. Creation of starter files is a reviewed proposal; never overwrite existing files on setup.

- `Synapse/Instructions.md`: human-editable Markdown prose and examples for headings, frontmatter, style, destination folders, and transformations. Structured frontmatter contains deterministic routing settings. Example: route daily-log research entries to `Daily/YYYY-MM-DD.md` in the user's configured timezone, under `## Log`, preserving unrelated content and avoiding duplicate entries.
- `Synapse/Security.md`: human-editable Markdown with schema-validated frontmatter for enforceable rules, plus explanatory prose. Separate permissions for internal retrieval, sending content to the active remote model, external MCP disclosure, and writing. Rules can match canonical folders, tags, and frontmatter; deny overrides allow. Masking uses explicit field rules or literal replacements, never model-generated regex. Ambiguous prose cannot grant access.
- `Research.md`: appendable rough-note inbox for the user or an authorized MCP client. Research is untrusted input, never a source of policy or operational permissions. Source URLs, dates, and client provenance may be recorded. External research is labeled as such; the plugin does not claim it independently verified web sources.

Control files and the inbox are excluded from ordinary vault search and MCP disclosure by default. The instruction and security loaders read them explicitly. External clients cannot modify control files. A dedicated setup flow may create a missing control file after the user reviews and approves its exact starter contents; it cannot overwrite one. Synapse does not change them through research updates; users edit them directly in Obsidian.

Example security intent: an external research agent may receive approved project facts, may receive an otherwise permitted project excerpt with configured client names replaced by `[CLIENT]`, and must never receive notes under `Private/`, credential fields, or health notes. These examples become enforced structured rules, not a prompt-only promise.

## 4. Main workflows

### Search and chat

The user asks a question; Synapse searches and reads only accessible Markdown, gathers evidence, and returns supported claims with note references. Local retrieval permissions do not imply permission to send a note to OpenRouter or an MCP client. Remote prompts and multi-turn history are filtered using current policy before each request.

### Research to notes

The user or an authenticated external agent submits rough material into Research.md. The user runs “Review research.” Synapse snapshots the selected batch and instruction version, searches permitted destination context, and proposes bounded creations or updates. The UI shows every destination, full before/after diff, provenance, and any unresolved ambiguity. The user accepts or rejects individual changes, then approves the selected batch for application.

No note creation, update, inbox append by the local assistant, or cleanup happens merely because a model suggested it. The exception is a user's explicitly authorized MCP client's scoped submission to Research.md, which can append inbox material without a note-update approval. Research processing never automatically clears or rewrites the inbox. Requests with ambiguous dates or destinations require user resolution before approval.

### External-agent collaboration

The user enables an MCP connection and grants a client scoped read-disclosure and/or research-submit capabilities. The client asks a bounded question; Synapse searches through the policy boundary and returns an allowed answer and safe references, a masked result, or a rejection. Titles, paths, citations, counts, errors, and trace details must not disclose denied information. The client can append research through its inbox capability but cannot approve or apply note changes.

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
- Formatting instructions cannot override security rules, grant network access, or execute code.

### F5/F11: Reviewed updates

- Model output is a schema-validated proposal using plugin-issued destination/evidence IDs. New paths are constructed and validated by the plugin from approved routing rules; model text is never used as an arbitrary path or command.
- The user sees the exact content to be written and approves it in the local UI. Rejecting or canceling writes nothing. External clients cannot approve.
- Approval is bound to proposal contents, source hashes, target hashes, policy version, and instruction version. Changed/deleted destinations, unsaved editor changes, changed research, or changed rules invalidate approval and require regeneration or renewed review.
- Only Markdown creation/update is supported; deletion, rename, binary writes, and control-file modification are rejected; the separate approved setup flow may only create missing starter control files. Each change is rechecked immediately before writing through the restricted write port.
- A multi-file failure reports exactly which changes succeeded; never claim atomicity. Recovery records prevent duplicate application. Reverts show a fresh diff and need approval.
- Processed research is tracked by batch IDs/content hashes; unchanged accepted batches are not reapplied automatically. Inbox material is preserved.

### F6–F7: Policy and MCP

- Security rules are validated deterministically. Missing/invalid policy denies MCP disclosure and submission and blocks note application. Ordinary excluded-note search remains fail-closed at ingest.
- Every tool result, prompt, answer, citation, MCP resource, and error checks recipient-specific permissions. Policy changes invalidate pending responses/proposals and revoke stale access before further delivery.
- Masking occurs before content reaches a remote provider or external client. If the requested guarantee cannot be enforced by configured deterministic rules, deny the disclosure.
- MCP is opt-in, local, authenticated, revocable, and bounded by client scopes, request size, rate, and execution limits. Its initial API offers scoped query and inbox submission, not a raw filesystem resource.
- An authorized inbox-only client can submit research but cannot query notes; an authorized query client sees allowed or masked results and generic denial responses for forbidden requests. Unauthorized clients receive no vault data.
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
