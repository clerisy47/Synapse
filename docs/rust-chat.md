# Native chat and automation contract

RUST-T04 connects the workspace corpus and provider queue to a plain text terminal and read-only `ask`. Answers initially consist of exact source passages selected for the question, with verified workspace-relative file and original line coordinates. There is no generated paraphrase or claim of semantic entailment proved by the compiler. Model relevance and broader answer quality remain RUST-T08 evaluation work.

## Commands and consent

```sh
synapse --workspace /absolute/notes
synapse ask --workspace /absolute/notes "What metal does Aurora use?" --json
synapse --workspace /absolute/notes --exclude-folder Private --exclude-tag secret
synapse --workspace /absolute/notes --instructions Synapse/Instructions.md --research Research.md
synapse ask --workspace /absolute/notes "question" --provider openrouter --model organization/model --json
```

Root validation fixes the canonical workspace before corpus access. Interactive mode requires stdin/stdout TTYs and displays the sanitized canonical root. Help/version and rejected invocations do not scan notes or create state. Search/chat need no control files. Control paths must be distinct validated relative Markdown paths; exclusions are fixed for this invocation. Restart to change configuration; a new session retains no history. The tag filter matches exact metadata tag values; folder exclusions follow the corpus policy's case-insensitive relative-prefix matching.

Interactive commands: `/search <literal terms>` searches without model work; `/source <positive ordinal>` rereads the last displayed source; `/help` shows commands; `/quit` or EOF exits successfully. Questions call the selected provider. An offline provider error leaves the session available for deterministic search. No write/review/setup/MCP command, approval flag, generic shell or URL fetcher is exposed.

OpenRouter requires explicit `--provider openrouter`, a model ID, a local stdin/stderr terminal and exact local `send` after disclosure. Consent is session-only and independent of MCP. It explains questions, permitted passages, instructions, selected research and bounded history sent to OpenRouter and its routed provider when used; this chat task sends only questions/history/body passages. The credential adapter reads `OPENROUTER_API_KEY` only after remote selection/consent; local mode does not read or attach it. Piped input cannot supply remote consent or write approval. There is no persisted remote permission, yes flag or fallback.

## Bounded retrieval and evidence

Core constants freeze a 384-byte question limit, at most three retained completed turns, six candidate passages, 1,024 aggregate passage bytes per request, three selected passages, three search terms of at most 64 bytes/four words, and three model calls per question. The application seeds a bounded lexical query, examines up to three hits, nearby body lines, and up to two permitted outgoing/backlink files per hit. It caps candidate passage resolution at 24 reads and checks a 180,000 ms turn deadline between model calls. Full scans and context/link operations have the separate corpus bounds; the 24 count is not a total filesystem-syscall count. Oversized lines do not enter the bounded candidate set; resource limits can lead to insufficient evidence. No source line or question is silently truncated.

The closed model schema contains only `evidence_ids` (current request ordinals) and literal `terms`, with unknown/duplicate fields refused. Every field is validated even if unused. The host selects the action: nonempty valid IDs yield exact passages; otherwise nonempty bounded terms request another retrieval; otherwise the result is insufficient. Supplemental terms alongside valid IDs are safe bounded data, not executable instructions or extra facts. No model-provided status, path, regex, quote, grant or approval is trusted. The zero-candidate schema requires an empty ID array; host checks independently reject absent IDs regardless of provider enforcement.

Historical questions supply context, never evidence. Retained evidence IDs must resolve against current workspace bytes/access before model input. Retrieval refreshes before requests, after responses and before returning selected passages. Any changed/excluded/stale input refuses the response and clears history/source handles. Failed turns also clear history. Source inspection rereads its ID and refuses stale content. Requests are snapshots of current bytes; unrelated editors can change files after a final read, so output is not a filesystem transaction.

Selection is extractive: the model cannot inject a fabricated quote or uncited factual sentence into the answer. This establishes source authenticity, not that a chosen passage semantically answers every question. Hop/byte/read limits and unsupported evidence yield explicit insufficient evidence; no model fallback or unconstrained summarization occurs.

All calls enter the existing JobQueue and shared provider lease. Serialized request bytes, schema/message overhead, output reservation and template reserve must fit the conservative 4,096-context budget; overflow returns MODEL_BUDGET. The output reservation is now 256 tokens. The 1,024-token template reserve remains provisional and model/template-specific qualification stays open. Large histories may exhaust the conservative budget; the application refuses rather than dropping approved content or silently shortening the question/history.

## State and cancellation

The StateStore adapter lazily provisions the private global application state root only when acquiring a model lease. macOS uses `~/Library/Application Support/Synapse`; Linux uses absolute `$XDG_STATE_HOME/synapse` or `~/.local/state/synapse`. State paths are bounded to 4,096 bytes/64 components. The adapter opens each component descriptor-relative with no-follow, creates missing directories with mode 0700, rejects overlap with the workspace and refuses broadly accessible final state roots. It does not chmod existing directories, import legacy data or write Markdown. The fixed mode-0600 lease file is the only file created. Future workspace-specific state/history uses the previously selected hashed identity layout; chat history is currently memory-only. Starting, searching and quitting without model work creates no state.

A signal adapter maps Ctrl-C to cooperative cancellation. Canonical terminal modes are never changed. A bounded input thread/channel lets idle Ctrl-C exit without waiting for a newline; the OS closes its blocked read when the process exits. Queued/lease waits poll cancellation; a blocking HTTP call may still take up to its 30-second deadline. The queue retains its lease until that call returns, suppresses its result, and exits 130. No detached model request outlives its guard. Immediate socket abort and server-side abandonment semantics are not proved here. There are no begun note writes to reconcile in this task.

Untrusted roots, file names, passages and format/direction controls are escaped for terminal display; passage lines wrap conservatively using Unicode display widths and bounded COLUMNS (8–240, default 80). Output is always monochrome, including NO_COLOR. Sanitization never changes source bytes or original citation coordinates. JSON escapes controls without changing its parsed text values. Application-owned progress/fixed diagnostics go to stderr. Raw provider/OS errors, prompts, credentials and note text never enter diagnostics.

## JSON v1 and exits

Successful `ask --json` emits one newline-terminated object on stdout:

```json
{"version":1,"status":"supported","answer":"Aurora uses cobalt.","sources":[{"id":1,"path":"Aurora.md","start_line":6,"end_line":6,"text":"Aurora uses cobalt."}]}
```

The insufficient form has `status: "insufficient_evidence"`, `answer: ""`, `sources: []`. Errors have exactly `version`, `status: "error"` and fixed `code`; no question or path is copied. Success sources use one-based display IDs and line coordinates. Stdout contains no progress/root/prompt in automation mode. Exit codes: 0 successful/insufficient; 1 model/runtime/output failure; 2 usage, invalid root or model configuration; 3 interactive/consent refusal or stale/policy conflict; 130 interrupted. Broken output streams can prevent delivery of a complete JSON value and return an output failure.

## Verification and known limits

Real controlling PTYs exercise native root sanitization, narrow Unicode output, offline search/source reads, unchanged terminal settings and terminal-generated SIGINT. The separate test-only `terminal-driver` composes scripted model decisions with real filesystem/application/terminal ports to exercise conversation, stale exclusions, piped JSON, no piped consent, invalid IDs and in-flight cancellation. It is compiled as an example for tests, not installed or included in native archives. Scripted decisions do not establish model quality. Ephemeral HTTP tests independently exercise the real provider builder/decoder, queue, OS lease and fresh filesystem citations.

Live opt-in commands never run in CI or start a runtime:

```sh
SYNAPSE_LIVE_BONSAI=1 python3 scripts/check-native-bonsai.py
SYNAPSE_LIVE_BONSAI=1 cargo test --locked -p synapse-adapters live_retrieval_shape_diagnostic -- --ignored --nocapture
```

The first checks two fixed synthetic supported/unsupported questions through the native CLI plus a real controlling-PTY conversation/source/Ctrl-C flow, prints bounded categories/timings, preserves fixture bytes and uses production global lease/state configuration. It stops after failure, without automatic retries. The second is a content-free shape diagnostic, not a quality gate.

2026-10-18 macOS arm64 live evidence: the initial status-plus-arrays contract yielded two MODEL_FORMAT results (7.59 s and 2.68 s). Fixed metrics showed a supported result containing both valid IDs and supplemental terms; the host rejected the inactive array. The final two-field schema moves action selection into the host and retains bounds, duplicate/unknown-field checks and current ID validation. An intermediate retry timed out (30.9 s), then found the endpoint offline (0.05 s); the server process was absent. No cause was established and Synapse did not restart/reconfigure it. The user restored the server. Synthetic health then passed in 1.19 s, and the final native CLI probe passed 2/2 cases: exact cited cobalt passage in 3.39 s and unsupported launch date in 6.25 s. A subsequent run adding real native+Bonsai PTY coverage passed both one-shot cases again (3.54 s / 5.91 s) plus conversation, source inspection, exit 130 and unchanged terminal modes (1.90 s for the PTY flow). Notes stayed unchanged. These are smoke results on the user-declared Bonsai runtime, not an attestation of model weights/build/context/slots, a quality denominator beyond these two cases, or release qualification. Full model/research quality and real OpenRouter/MCP interoperability remain open.

Dependency changes: pinned ctrlc 3.4.7 (MIT/Apache-2.0, Unix nix/libc signal machinery) stays in adapters; pinned unicode-width 0.2.2 (MIT/Apache-2.0, defaults/cjk disabled) stays in terminal; pinned serde 1.0.229 derive enables closed duplicate/unknown-field parsing only in the model adapter. Existing serde_json is reused for terminal serialization, with parsing forbidden at that boundary. Nix's build script emits reviewed cfg aliases; cfg_aliases is a compile-time helper. Proc-macro2/quote build probes were already in the inventory; enabling derive now compiles the reviewed serde_derive/syn proc macros. No local build script, shell/network dependency in domain code, native model runtime or Node dependency is added. The full resolved feature/license/build-script graph is regenerated from Cargo metadata and frozen by the boundary check. Later release license/target qualification remains RUST-T09 work.
