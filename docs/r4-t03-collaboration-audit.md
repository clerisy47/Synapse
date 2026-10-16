# R4-T03 — Scoped collaboration semantics

`collaboration` owns semantic work behind authenticated, schema-validated MCP calls.
Its dependencies are public feature facades and injected ports. No transport or write
allowlist expansion is needed. `main.ts` composes current services; settings rebuild,
unload and source/control changes retain the adapter's cancellation boundary.

## Queries

Each request opens independent internal, remote-model and external-client evidence
sessions. All three must permit retrieval. Field and literal masks compose before
model input; frontmatter and known path/title/alias values are removed. Titles in
model evidence are ordinal-neutral. Provider calls run at MCP priority below chat,
health and local research, through the single JobQueue, with current-access guards
on physical retries. No client history is accepted.

The response intentionally uses an **extractive answer** assembled from projected,
verified cited excerpts. Generated prose is not forwarded: even a schema-valid model
claim cannot prove absence of hallucinated private facts or metadata. Each reference
has a fresh random 128-bit ID, ordinal label and at most 600 Unicode code points;
there are at most 12 references. These IDs are response labels only, with no stored
map, resolver or ongoing capability (so no reference authority survives the request).
Answers are bounded to 12000 code points and the transport also enforces its byte cap.
Original paths, quotes, anchors, model prose, errors, traces and counts stay private.
Controls and remembered source text are read again before response delivery.

## Submission and recovery

The inbox is privileged for this operation only. User folder/tag/frontmatter
exclusions still apply; the corpus's blanket control-file ingestion exclusion is
not a substitute for this write decision. Valid current controls, explicit external
append permission, scope, exact disk text, all open inbox editors and all open control
editors are checked before the atomic append. No create/delete/rename/target-note
capability is passed to the client.

Client text is normalized to LF, JSON-quoted on one blockquote line and escapes
markup delimiters. Sources are inert, unverified provenance, never fetched. Server
client ID, UTC receipt time and unpredictable boundary markers frame the append.
Existing inbox content is preserved.

A single lifetime service serializes submissions. `mcp-receipts.json` contains client
ID, hashed key/payload, receipt, timestamp, destination, hashes of before/after/append
and intent/outcome, **no research body or approval**. Intent is flushed before write;
outcome is flushed after. An identical client/key/payload retry returns the durable
receipt; changed payload returns fixed conflict. An uncertain intent can become
accepted only after finding exactly one complete server marker block whose hash
matches and the original prefix/expected appended snapshot hashes match. Later appends may follow that snapshot. An absent, edited or ambiguous block stays unavailable and is never retried.
Storage write failure blocks further submissions until restart; malformed journals
fail closed. Accepted receipts expire after 30 days; uncertain intents are retained.
Capacity is 1000 and unexpired entries are not evicted to admit new submissions.

A successful append emits a vault change and can invalidate its own HTTP delivery.
Clients must initialize again and retry the **same key/payload**; the durable receipt
resolves this without another write. Cancellation before commit writes nothing;
cancellation after commit does not undo the append or discard its journal outcome.
Revocation never removes research.

## Verification

Synthetic facade and production HTTP tests cover intersected recipient denial,
masking, forbidden metadata/provider payloads, discarded generated prose, fresh
references, changed-source refusal, scope filtering/revocation, duplicate and concurrent
submissions, client namespaces, journal failures, crash reconciliation, commit races,
capacity and expiry. The plugin-host test exercises real `main.ts` composition,
StoragePort, the shipped server and restricted appender, including source-event
invalidation and receipt retry. Run with `SYNAPSE_SMOKE_BUNDLE=1` to test `main.js`.

Typecheck, lint (existing warnings only), dependency boundaries, network/write/schema
gates and production build passed. The full suite passed 839 tests (one existing
opt-in live test skipped); mini-vault passed 83 checks; the production bundle passed
four host tests. These are synthetic/headless checks. Real Obsidian/native-client
workflow and live `openrouter/free` validation remain at R5-T03; none is claimed here.
