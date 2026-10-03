# SPEC: Synapse

A fully local, agentic second-brain assistant for Obsidian.

Status: draft v1, produced from interview (Batches 1–3). Target: community-plugin-ready release.

---

## 1. Goal and users

### Goal

Synapse is a desktop Obsidian plugin in which a small on-device LLM (served by the user's own Ollama) answers questions about a vault, flags possible contradictions between notes, and resurfaces old notes with a stated reason. It does this by searching the vault the way a coding agent searches a codebase: using bounded, tool-based search over full text, titles, links, backlinks, tags, and frontmatter. It uses **no embeddings, no vector database, and no cloud calls**. Every output cites the exact source it came from.

### Users

People with large, serious personal knowledge bases (researchers, writers, engineers, lifelong note-takers) who:

- have thousands of notes and PDFs and lose track of what is already in them,
- are unwilling to upload personal or unfinished notes to a third party,
- run Obsidian on a desktop machine, down to an 8 GB Apple Silicon Mac.

### Success definition

A published, reviewed community plugin that installs cleanly, works on the hardware floor below, never modifies user notes, never sends data off the machine by default, and measurably clears the fixture-vault quality bars in section 5.

---

## 2. Prioritized features

### Must

| ID | Feature | Summary |
|----|---------|---------|
| M1 | Model runtime and harness | Ollama client, first-run health check, grammar/JSON-schema-constrained calls, single priority job queue, cancel, status indicator, non-blocking errors. |
| M2 | Search toolbox and bounded agent loop | Tools: `search_text`, `search_by_title`, `get_links`, `get_backlinks`, `search_by_tag`, `get_frontmatter`, `list_recent`, `read_note`. Fixed state machine (plan → search → read → evaluate → stop), hop cap, token budget, duplicate-call detection. |
| M3 | Q&A sidebar chat | Sidebar pane; answer with clickable citations; collapsible trace of search hops; citation verification. |
| M4 | PDF text-layer ingestion | Text extraction for text-layer PDFs with page numbers; scanned PDFs flagged "unsupported — scanned" and excluded. |
| M5 | Shared `compare` primitive | `compare(candidate, context) → relation + one-line reason`, built once and used by M6 and M7. |
| M6 | Contradiction / drift detection | Claim extraction, targeted search, double-pass classification, flags in gutter and sidebar Flags list, dismissal. Triggered by explicit command. |
| M7 | Agentic resurfacing | Daily run on first vault open, rule-scored candidates, model relevance check and reason, sidebar panel, dismissal with downweighting. |
| M8 | Privacy, exclusions, and state | Loopback-only default, no telemetry, folder/tag/frontmatter exclusions, plugin-local state only, never edits notes. |
| M9 | Release readiness | Settings UI, README disclosures, MIT license, versioned release artifacts, eval harness and fixture vault. |

### Should

| ID | Feature | Summary |
|----|---------|---------|
| S1 | On-save contradiction check | Optional setting, default **off**, debounced ≥30 s, non-blocking. |
| S2 | Multi-turn chat | Keeps the last 3 turns as context; every turn re-runs search. |
| S3 | "Clear all Synapse data" command | Wipes dismissals, open log, and caches. |
| S4 | Recommended-model list | Models are listed as "recommended" only if they clear the eval bar in section 5. |

### Later

- SQLite FTS5 index for faster text search.
- Optional local embedding model as a recall booster (would relax the "no embeddings" rule; needs its own decision).
- Read-only mobile experience.

---

## 3. Non-goals

- Mobile inference or mobile support (`isDesktopOnly: true`).
- Scanned or image PDFs, OCR, voice capture, handwriting.
- Cloud inference or any cloud API calls.
- Embeddings or a vector database in this release.
- Editing, rewriting, or inserting into user notes (the plugin only navigates to them).
- Multi-vault support.
- Runtimes other than Ollama (LM Studio, llama.cpp server, OpenAI-compatible endpoints).
- Bundling a model runtime with the plugin.
- Tested support for non-English notes (best-effort only).
- Telemetry, analytics, or update pings.
- Presenting contradiction flags as errors. They are only "worth a second look."

---

## 4. Constraints

**Platform and stack**
- Desktop only: `isDesktopOnly: true` in `manifest.json`. `minAppVersion` is set and tested.
- TypeScript on the Obsidian Plugin API. Ollama is the only supported runtime, and the user installs it themselves.
- Every model call uses structured output (JSON-schema or grammar-constrained). Free-form model output is never parsed.

**Hardware floor**
- Supported: Apple Silicon (M1 or later) with 8 GB unified memory, or a Windows/Linux machine with a GPU of ≥6 GB VRAM.
- Best-effort: CPU-only with 16 GB RAM.
- Default model context is capped at about 4–8K tokens.
- The plugin never loads a model on its own; the user pulls it.

**Model**
- The model is not fixed. It is user-configurable in settings and must be available in Ollama.
- Candidate families: a small non-thinking instruct model, or Qwen3-4B-class, to be confirmed by the Phase 0 bake-off.
- Thinking output must be disabled or stripped, since it conflicts with constrained output and hurts latency.

**Scale**
- Up to 10,000 notes and 500 text-layer PDFs.
- An in-memory content cache is kept fresh by vault file events.
- Any single tool call returns within 2 s on floor hardware.

**Privacy and network**
- Default endpoint is loopback: `http://127.0.0.1:11434`.
- The endpoint is configurable. A non-loopback endpoint triggers a visible warning.
- No telemetry and no update pings.
- Note content is never logged to disk beyond the plugin's own cache.
- Network behavior is disclosed in the README and in settings.

**Data and sync**
- Dismissals and the open/edit log live in `data.json` and are merge-tolerant, so a sync conflict never prevents the plugin from loading.
- The PDF text cache is a separate rebuildable file, keyed by path + mtime, that is safe to delete.
- The plugin writes only to its own plugin folder.

**Concurrency**
- One model job at a time, in a single priority queue: user Q&A > contradiction check > resurfacing.
- Background jobs pause while Q&A runs.

**Language**
- English is tested and supported. Prompts are in English. Note text may be in any language, but only English is covered by acceptance criteria.

**Release**
- MIT license, semantic versioning, GitHub releases with `main.js`, `manifest.json`, `styles.css`.
- README documents the Ollama requirement, hardware floor, network behavior, and the no-telemetry promise.
- The plugin must comply with Obsidian's developer policies and plugin guidelines.

---

## 5. Acceptance criteria

Latency figures apply on floor hardware (8 GB Apple Silicon, or 6 GB VRAM GPU) with a model that meets the eval bar. "Fixture vault" means the seeded test vault defined in AC-M9.

### M1: Model runtime and harness

- AC-M1.1: On first run, a health check reports separately whether the Ollama server is reachable, whether the configured model is present, and whether a trivial schema-constrained call returns valid JSON. Each failure shows a specific remediation message.
- AC-M1.2: The plugin never pulls a model or starts Ollama on its own.
- AC-M1.3: If Ollama is unreachable, all AI features are disabled with a clear message, and the plugin still loads without errors.
- AC-M1.4: Across 100 constrained calls in the eval suite, 100% of parsed outputs conform to the requested schema (schema validation is enforced, and failures retry once, then fail visibly).
- AC-M1.5: Jobs run one at a time. When a Q&A job is submitted while a background job runs, the background job pauses and resumes after Q&A completes.
- AC-M1.6: Every job has a working cancel control, and cancellation stops model generation within 2 s.
- AC-M1.7: A status-bar indicator shows model state (idle / running / paused / error).
- AC-M1.8: Model errors and timeouts surface as non-blocking notices with a retry action and never block the UI thread.

### M2: Search toolbox and bounded agent loop

- AC-M2.1: Each tool in the toolbox has a unit test against the fixture vault covering typical input, empty result, and excluded-note input.
- AC-M2.2: `get_links`/`get_backlinks` are derived from Obsidian's metadata cache. No separate index is built.
- AC-M2.3: The loop enforces a hop cap (default 6). A test forcing a never-satisfied query terminates at the cap and returns an "insufficient evidence" result.
- AC-M2.4: The loop enforces a token budget, and the assembled context never exceeds the configured cap.
- AC-M2.5: A repeated identical tool call (same tool and arguments) within one run is rejected and counted as a hop.
- AC-M2.6: The state machine is verified with a mocked model: every transition path (plan → search → read → evaluate → stop, and evaluate → search) is exercised, and invalid model-chosen transitions are rejected.
- AC-M2.7: Excluded notes (section M8) never appear in any tool output.

### M3: Q&A sidebar chat

- AC-M3.1: A sidebar pane can be opened by command and ribbon icon.
- AC-M3.2: Submitting a question shows first visible progress within 3 s and a full answer within 45 s.
- AC-M3.3: Every factual claim in an answer carries a citation. Clicking one opens the exact note (or PDF at the cited page) and scrolls to the cited passage.
- AC-M3.4: Citation verification: each cited quote is substring-checked against the source text. On failure the system retries once with the failure fed back. If it still fails, the claim is visibly marked "unverified" and is not shown as sourced.
- AC-M3.5: A collapsible trace lists each search hop (tool, arguments, result count). It is collapsed by default.
- AC-M3.6: When evidence is insufficient, the answer says so plainly and does not fabricate a citation.
- AC-M3.7 (S2): With multi-turn on, only the last 3 turns are included as context, and each turn re-runs search rather than reusing old evidence.

### M4: PDF text-layer ingestion

- AC-M4.1: For a text-layer PDF in the fixture vault, `search_text` returns hits with page numbers, and `read_note` returns text for a requested page.
- AC-M4.2: A PDF whose average extracted text is <50 characters per page (over up to 5 sampled pages) is marked "unsupported — scanned", excluded from all searches, and listed in a settings view. No OCR is attempted.
- AC-M4.3: A mixed PDF is judged by the sample average and treated all-or-nothing.
- AC-M4.4: Extracted text is cached in a separate file keyed by path + mtime. Changing the PDF invalidates its entry, and deleting the cache file causes a clean rebuild.
- AC-M4.5: A corrupt or password-protected PDF is skipped with a logged, non-blocking notice and does not fail the search.
- AC-M4.6: Extraction runs off the main interaction path, and opening Obsidian with 500 PDFs does not freeze the UI for more than 500 ms at a time.

### M5: Shared `compare` primitive

- AC-M5.1: `compare(candidate, context)` returns `{relation, reason, quotes}` where `relation ∈ {agree, disagree, unrelated}`, and it is the only code path used by M6 and M7.
- AC-M5.2: Output is schema-validated, and `reason` is a single line.
- AC-M5.3: Swapping the order of candidate and context is supported and is used for the double pass in M6.

### M6: Contradiction / drift detection

- AC-M6.1: An explicit command runs a contradiction check on the active note.
- AC-M6.2: Claim extraction returns 2–5 short claims for a note with enough content, and returns none for empty or trivial notes.
- AC-M6.3: For each claim, candidate notes come from `search_text` plus one graph hop through tags/links. Candidates are scoped toward notes not touched in the current session.
- AC-M6.4: A conflict is flagged only if the classifier returns "disagree" on two consecutive constrained passes (the second with candidate/claim order swapped), and a verbatim quote from each note is attached and substring-verified.
- AC-M6.5: A flag shows in a gutter marker on the claim's line (Edit and Live Preview) and in the sidebar Flags list. The list shows both snippets side by side, the older note's date, and a jump link to each.
- AC-M6.6: Flag wording reads "may conflict with [[Note]] (dated X)". The UI never uses the words "error" or "wrong".
- AC-M6.7: Dismissing a flag suppresses that specific claim/note pair permanently. It stays suppressed after restart and after a `data.json` merge.
- AC-M6.8: A single check completes in ≤60 s as a background job and never blocks typing.
- AC-M6.9 (S1): With on-save enabled, the check starts no sooner than 30 s after the last edit, is cancelled by further edits, and is off by default.
- AC-M6.10: On the fixture vault, contradiction precision is ≥90% and recall on seeded contradictions is reported (with a target of ≥50%; recall is best-effort, precision is the priority).

### M7: Agentic resurfacing

- AC-M7.1: The run happens once per calendar day on the first vault open that day and never repeats that day. There is also a manual "run now" command.
- AC-M7.2: Candidates are notes untouched for ≥N days (default 90, configurable). "Last touched" is the later of file mtime and the plugin's own open/edit log.
- AC-M7.3: If >50% of notes share a near-identical mtime, the plugin falls back to a configurable frontmatter date field (default `created`) and shows a one-time explanatory notice. (See open question OQ-3 for the definition of "near-identical".)
- AC-M7.4: Candidates are rule-scored by backlink count and overlap (tags, links, terms) with the session's active notes. The top 30 are kept, and the model checks at most 15 of them via `compare`.
- AC-M7.5: Only notes classified as related are shown, at most 5 per day. If none qualify, the panel says so and does not pad.
- AC-M7.6: Each surfaced note shows a one-line reason that references verifiable content of the note and links to it.
- AC-M7.7: Results appear in a sidebar panel and never as a popup.
- AC-M7.8: A dismissed note is not resurfaced again unless the user un-dismisses it. Dismissing 3 notes in the same folder or tag within 30 days halves that group's weight for the next 60 days (verified by unit test with a fake clock).
- AC-M7.9: With no history (fresh install), the run still works using mtime or frontmatter dates, and shows no errors.
- AC-M7.10: The full daily run finishes in ≤5 minutes as a background job, pausing while Q&A runs.

### M8: Privacy, exclusions, and state

- AC-M8.1: An integration test that blocks all non-loopback network traffic passes every feature in the suite.
- AC-M8.2: With a non-loopback endpoint configured, a warning is visible in settings and at first use.
- AC-M8.3: The codebase contains no telemetry, analytics, or update-check calls (verified by code review checklist and a grep-based CI check).
- AC-M8.4: Notes in excluded folders, notes with excluded tags, and notes with `synapse: ignore` in frontmatter are never searched, never sent to the model, and never appear in results, flags, or resurfacing.
- AC-M8.5: The plugin performs no writes to any file outside its own plugin folder (verified by test that spies on vault write APIs).
- AC-M8.6 (S3): The "clear all Synapse data" command removes dismissals, the open log, and caches after confirmation.
- AC-M8.7: Loading a `data.json` with conflicting or partially missing fields does not throw, and unknown fields are preserved.

### M9: Release readiness and evaluation

- AC-M9.1: A fixture vault ships in the repo, with seeded contradictions, known-answer questions, stale-but-relevant notes, text-layer PDFs, and at least one scanned PDF.
- AC-M9.2: A scripted eval reports, per model: JSON validity rate, citation validity rate, contradiction precision and recall, Q&A answer correctness on known-answer questions, and median latency for each job type.
- AC-M9.3 (S4): A model is listed as "recommended" only if it meets: JSON validity 100% (after one retry), citation validity ≥95%, contradiction precision ≥90%, and the latency budgets above on floor hardware.
- AC-M9.4: Unit tests with a mocked model cover the harness, state machine, queue, and scoring, and they run in CI without Ollama.
- AC-M9.5: The release contains `main.js`, `manifest.json`, `styles.css`, has `isDesktopOnly: true`, an MIT license file, and a README covering the Ollama requirement, hardware floor, network behavior, and no-telemetry promise.
- AC-M9.6: The plugin passes Obsidian's plugin-review checklist (no unnecessary global access, proper cleanup on unload, no innerHTML from untrusted content, settings UI uses the API's setting components).
- AC-M9.7: Unloading the plugin cancels running jobs, removes gutter extensions and views, and leaves no listeners.

---

## 6. Open questions

**Technical risks to verify in Phase 0**

- **OQ-1: Ollama CORS.** Requests from Obsidian's renderer originate from `app://obsidian.md`, which Ollama may block unless `OLLAMA_ORIGINS` is set. `requestUrl` bypasses CORS but does not stream. Decide between `fetch` (streaming, requires user config) and `requestUrl` (no streaming, no user config), or a hybrid. This affects the "first visible progress within 3 s" criterion.
- **OQ-2: Backlinks API.** `getBacklinksForFile` is referenced in the original brief but may not be part of Obsidian's public typings. Fallback: invert `metadataCache.resolvedLinks` ourselves. Decide which is safer for community review.
- **OQ-3: "Near-identical mtime".** Proposed definition: more than 50% of notes share an mtime within the same 1-hour window. Needs a sanity check against real synced and cloned vaults.
- **OQ-4: pdf.js access.** Confirm that Obsidian's bundled pdf.js can be loaded from a plugin (e.g. via `loadPdfJs`) and can extract text without opening the viewer. Fall back to a bundled dependency only if it cannot, and account for bundle size.
- **OQ-5: Model choice.** Names in the original brief (a Gemma-family E4B model and Qwen3-4B-Thinking) need confirming against the current Ollama library, plus memory footprint at the 4–8K context cap on an 8 GB Mac. The 8 GB floor may force ≤3B models or a smaller context. If nothing passes the eval bar, the hardware floor must be revised.
- **OQ-6: Structured output with the chosen model.** Verify that Ollama's schema-constrained output works reliably with the chosen model, including how thinking output is disabled.

**Product decisions still open**

- **OQ-7: Contradiction recall.** The target of ≥50% on seeded contradictions is a placeholder. Real recall with keyword search, query rephrasing, and one graph hop is unknown until measured. The plan is to agree on a recall floor after the first eval run, and decide then whether FTS5 moves up from Later.
- **OQ-8: Debounce and battery.** Confirm that the 30 s on-save debounce doesn't drain laptops on battery. Consider pausing background jobs on low battery or when the system is under memory pressure.
- **OQ-9: Claim scoping.** "Notes untouched in the current session" is the drift filter, but what about contradictions between two recently edited notes? Decide whether they should be flagged or ignored.
- **OQ-10: Resurfacing "related" bar.** How strict should the relevance classifier be, given the "don't pad" rule? Tune against the fixture vault.
- **OQ-11: Excluded-note handling in links.** If an allowed note links to an excluded note, should the link title be visible to the model? Proposed default: no, the link is treated as unresolved.
- **OQ-12: Quote length and copyright/fair display.** Set a maximum quote length shown in flags and citations (proposed: 300 characters) to keep the UI readable.
- **OQ-13: Concurrency across vault windows.** With multiple Obsidian windows on one vault, decide whether jobs share one queue.
- **OQ-14: Accessibility and theming.** Confirm that the gutter marker and panels meet contrast and keyboard-navigation expectations in light and dark themes.
- **OQ-15: Internationalization of UI strings.** Confirm that UI strings stay English-only in v1 and are structured so translations can be added later.
