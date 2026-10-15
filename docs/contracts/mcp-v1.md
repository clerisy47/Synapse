# MCP v1 contract — R4-T01

## Transport decision

Use Streamable HTTP, pinned to MCP **2025-11-25**, with JSON responses,
initialization and no sessions, SSE, resumability or server-initiated requests.
GET and DELETE return 405. Support only native clients able to configure a bearer
header. This deliberately excludes browser clients and automatic OAuth discovery;
manual local provisioning is the authentication mechanism, not an OAuth claim.

The normative baseline is the [versioned transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
A newer draft changes transport semantics; do not silently adopt it. R4-T02 must
validate initialization, protocol headers, notifications and JSON-RPC errors against
this pinned version, preferably using a compatible official SDK. The spike here
proves Node loopback/authentication/cleanup feasibility, not full MCP conformance.
Stdio was rejected because Obsidian already owns the server lifecycle; clients must
not launch independent vault readers. Legacy HTTP+SSE is not supported.

Bind exclusively to IPv4 127.0.0.1, OS-assigned port, exact endpoint `/mcp`.
No LAN, wildcard, IPv6, proxy or configurable hostname. Display the effective URL
locally. Validate exact Host `127.0.0.1:<bound-port>`; reject every present Origin
(including null), duplicate Host/Authorization, query strings, other paths and
forwarded headers. Do not enable CORS. Origin rejection uses 403. Authenticate
before parsing JSON, listing tools or handling initialization; failures return fixed
401 without client, vault, policy or token details. Never accept credentials in URLs.
Loopback plaintext assumes a trusted local OS: malware running as the user can
steal credentials. No remote access or TLS termination is supported.

## Pairing and authority

Disabled by default. Local settings action enables the listener and creates a client
with an opaque random ID, user-visible local label and explicit independent scopes
`query-vault` and/or `submit-research` (default none). Local user confirms scopes;
client input cannot self-register, elevate, rotate or revoke. Generate 32 random
bytes per client with Node crypto; show base64url bearer once. Persist only SHA-256
digest, ID, label, scopes and revocation generation through StoragePort. Never reuse
OpenRouter keys, store plaintext tokens, emit tokens in diagnostics, or include them
in synced example configuration. Compare fixed-size digests in constant time.
A lost token requires a newly provisioned client; no token recovery.

Revocation and scope edits advance authority generation immediately, cancel queued
and active work, invalidate reference maps and prevent late delivery. Persist before
reporting success; persistence failure disables the listener until resolved. Disabling,
unload, settings rebuild and startup failure close listener/sockets, cancel jobs and
clear ephemeral authority. Restart loads only durable grants; no pending request or
approval survives. Never auto-enable after malformed grant storage. Policy/control
changes independently invalidate pending work and safe references. Recheck current
client, policy and source snapshots immediately before replies and inbox writes.

## Semantic schemas (strict objects, unknown fields rejected)

Only `query_vault` and `submit_research` are tools. No resources, prompts, roots,
sampling, raw filesystem, note enumeration, approval or apply operations. Tool list
is scope-filtered after authentication. Unknown/unscoped calls use fixed rejection.
IDs, paths, selectors, policy text and approval tokens are never accepted as authority.
All sizes below are provisional frozen v1 maxima; implement as named constants.

`query_vault` input:

```json
{"question":"nonblank text, 1–4000 Unicode code points"}
```

No caller-supplied history, paths or recipient identity. Server constructs current
external-client access context from authenticated grants. Retrieval intersects local
and external permission; any model input also requires remote-provider permission.
Use JobQueue MCP priority below interactive chat and local research. Never forward
an internal answer. Mask before evidence/prompt construction; only current permitted
evidence may support answer text. Fail closed if projection cannot be proven safe.

Success structured content:

```json
{"status":"answered","answer":"bounded text","references":[{"id":"ref_<opaque random base64url>","label":"Source 1","excerpt":"permitted masked text"}]}
```

Answer max 12000 code points; max 12 references; excerpt max 600 code points.
IDs use 16 random bytes, scoped to client, request and current policy/source generation;
expire after 5 minutes and on revocation or change. Labels are ordinal only: no title,
path, URI, mtime, total count, raw citation anchor or global identifier. IDs are opaque
labels, not dereferenceable resources; v1 exposes no resolver. The answer must not
leak path/title metadata through generated prose; redact or reject an unsafe answer.
No evidence/denial distinction externally: fixed `{"status":"unavailable"}`. Do not
return internal denial reasons, traces, matched counts or provider error bodies.

`submit_research` input:

```json
{"idempotencyKey":"client-chosen ASCII [A-Za-z0-9_-], 16–128 characters","text":"nonblank rough Markdown, max 32000 code points","sources":[{"url":"absolute https URL, max 2048 characters","accessedOn":"optional valid YYYY-MM-DD"}]}
```

`sources` optional, max 10, each strict object. Reject URL userinfo, fragments and
non-HTTPS schemes. URLs are inert provenance, never fetched or treated as citations
verified by Synapse. No date/destination routing authority from client text. Server
adds client ID and server UTC receipt timestamp, labels externally supplied unverified
research, and appends only to configured Research.md via ResearchAppendPort. Preserve
inbox contents; no approval or target-note write. Current valid policy must explicitly
allow append; controls, exclusions, editor/disk conflict checks still apply.

Success: `{"status":"accepted","receipt":"opaque server ID"}`; identical retries
return the same receipt. Namespace key by client ID and hash normalized validated
payload. Same key/different payload returns fixed `conflict`; no inbox text disclosed.
Serialize submissions and durably journal intent before append, outcome after append.
On uncertain restart/write, reconcile exact append marker and expected snapshots;
never blindly retry. Markers are server-generated unpredictable IDs; encode client
content so it cannot forge provenance headers or recovery boundaries. Retain deduplication receipts for 30 days, max 1000 entries; reject
new submissions at capacity rather than evict unexpired keys. Older retries may append
again after expiry; disclose this window in settings. Revocation never removes inbox.
Policy denial returns the same unavailable shape as query.

Tool success uses MCP structuredContent plus a text block serializing exactly that
safe object. Tool failures use isError with fixed public copy; do not echo arguments.
Protocol invalid parameters use -32602, unknown method -32601, parse error -32700.
No raw exception message is serialized. JSON-RPC request IDs are strings <=64 ASCII
characters or safe integers; reject batches, null IDs, duplicate in-flight IDs and
unknown envelope fields except protocol-defined bounded `_meta`.

## Bounds and implementation changes

| Boundary | Maximum / behavior |
|---|---|
| Request body | 64 KiB UTF-8 bytes, enforced while streaming before JSON parse |
| Headers | 8 KiB; 5-second header/body timeout; no content encoding |
| Rate | 20 requests/minute/client, burst 5; unauthenticated 60/minute globally |
| Concurrency | 1 active semantic request/client, 4 globally; reject overflow |
| Work | 60-second deadline including queue wait; cancellation drops late reply |
| Output | 64 KiB serialized bytes; fixed unavailable on overflow |
| Grants | 16 clients; local labels <=80 code points |

R4-T02 adds only `src/adapters/node/mcp-server.ts` to the network allowlist, exports
through adapter index and introduces core injected server/credential ports. No feature
socket I/O, outbound requests or generic listener allowlist. Add settings/grant storage
and main composition lifecycle then. R4-T03 introduces collaboration facade dependency
rules, recipient-aware query and serialized append recovery; no model schema changes
are authorized by this design. Existing write checker permits only restricted adapter
APIs; inbox composition must not widen note-write authority.

## Threat review and release evidence

| Case | Required outcome |
|---|---|
| Malicious website / DNS rebinding | Any Origin or wrong Host rejected before dispatch |
| Missing, guessed, revoked bearer | Fixed unauthorized; no tools or vault metadata |
| Submit-only client queries or injects approval/path | Scope rejection or strict schema refusal |
| Missing/invalid policy; changed policy during job | No content/write; late result discarded |
| Masked/denied metadata in citations or prose | Safe ordinal projection or unavailable |
| Oversize, slow body, flood, disconnected peer | Bounded resources; cancellation and cleanup |
| Duplicate submission / crash after append | Receipt replay or conservative reconciliation |
| Unload/rebuild while queued or writing | Cancel delivery, close sockets; no blind replay |

`test/integration/mcp-transport-spike.test.ts` exercises an ephemeral synthetic
loopback server: authenticated request, Host/Origin rejection, revocation and closure.
It does not implement production pairing, schemas, limits, MCP handshake, policy or
append semantics. Those are explicit R4-T02/R4-T03 acceptance tests. Real Obsidian
and native-client interoperability remain at R5-T03; do not claim them from this spike.
