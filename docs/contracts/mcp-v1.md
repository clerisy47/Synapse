# Terminal collaboration contract — v1

Native implementation uses the protocol/SDK pin and measured limits below. Authority and wire checks are recorded separately in the native qualification evidence; no former host result is counted. SDK dispatch remains inside the independently authenticated adapter boundary.

## Lifecycle and authority

An explicit `synapse mcp serve --workspace <directory>` process owns a local Streamable HTTP listener, disabled until locally configured. Bind numeric IPv4 loopback `127.0.0.1` on an OS-assigned port, fixed `/mcp` endpoint; no LAN binding, proxying, browser access or CORS. Validate exact Host and reject present Origin, forwarded headers, query strings and credential URLs. Authenticate before parsing semantic input or exposing tools. Never auto-start a daemon.

Local user provisions independent `query-workspace` and `submit-research` scopes, default none. Generate 32 random bytes for bearer credentials; show once in a deliberate local provisioning flow, store only a digest through StateStore and compare in constant time. Never reuse provider credentials. Revocation persists before success, cancels queued work and prevents late delivery. Failed grant persistence disables service. No client self-registration, elevation, approval or credential administration.

## Tools

Only `query_workspace` and `submit_research`; scope-filter tool listing. No raw filesystem, arbitrary note enumeration, approval/apply, prompts, resources, shell or URL-fetching API. Proposed names replace the old application's wire API; compatibility is not required.

`query_workspace` accepts a strict object containing a nonblank question, at most 4,000 Unicode code points. No caller-selected root, trusted paths, history or recipient identity. Use current exclusions and current selected-provider consent through the shared model queue. Return bounded verified answer text and ordinal source references with safe excerpts, no internal paths/titles/traces/counts. References are ephemeral opaque IDs, not dereferenceable filesystem resources. Unsupported/denied/unavailable cases share a fixed unavailable shape to avoid revealing hidden content. Validate generated prose as well as citation metadata before delivery.

`submit_research` accepts strict fields: idempotencyKey (16–128 ASCII letters/digits/underscore/hyphen), nonblank text (<=32,000 code points), and at most ten optional source records (HTTPS URL <=2,048 characters plus optional YYYY-MM-DD accessedOn). Reject URL credentials/fragments; never fetch provenance URLs. Server adds trusted receipt/client/time metadata, escapes client content against forged markers and appends labeled unverified research only to the configured inbox. No destination selection or note approval authority.

Namespace idempotency by authenticated client, key and validated payload hash. Identical retries return the same opaque receipt; changed payload returns conflict. Persist intent before append and outcome afterward under the shared workspace write lock. Reconcile uncertain writes; never blindly append again. Retain receipts for 30 days, proposed cap 1,000; refuse new work rather than evict unexpired/uncertain records. Explain that retries after expiry can duplicate research.

## Bounds and checks

Proposed limits: 64 KiB request/output, 8 KiB headers, five-second header/body timeout, 20 requests/minute/client with burst five, one active request/client, four global semantic requests, 60-second deadline including queue wait, 16 clients. Encode these as named constants and test before freezing. Reject overload with fixed errors; no raw exception strings or echoed arguments. Query output: <=12,000 code points, <=12 references, <=600 code points per excerpt. Final JSON-RPC envelopes, initialization, protocol headers and notifications follow the version pinned in RUST-T07.

Release checks include wrong Host/Origin, missing/revoked credentials, independent scopes, strict input rejection, oversized/slow requests, exclusions changing during work, safe references/prose, client disconnect, shutdown, concurrent CLI writes, crash/idempotency reconciliation and a real native-client initialize/query/submit/revoke cycle. This boundary cannot protect notes from a client separately given direct filesystem access.

## Native implementation pin — 2026-10-19

The implementation pins the [2025-06-18 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) and official [rmcp 0.8.5 source](https://crates.io/crates/rmcp/0.8.5). This is an explicit compatibility target, not a claim to implement later protocol revisions. Initialization returns 2025-06-18; unsupported version headers are refused. The service is stateless, returns JSON for one SDK-dispatched response, accepts initialized notifications with 202 and refuses GET/DELETE with 405. The listener rejects all Origin headers, wrong numeric Host, forwarded headers, duplicate headers, query strings, transfer encoding, duplicate JSON keys and over-budget inputs. Rejected connections may reset when unread body bytes remain; no client text is echoed.

`mcp grant` requires a local TTY, explicit scopes and `Grant`; it displays a dedicated secret once. Only the digest is persisted. Grants bind the explicit access configuration. `mcp revoke --client ID` persists removal; history clearing revokes all grants. Query results contain only app-owned permitted excerpts and ordinals. Delivery rechecks evidence and grant under the shared lock. The service serializes semantic requests (a stricter ceiling than four global), with a five-second raw I/O budget, 64 KiB bodies/output, 8 KiB headers and 20/minute/client with burst five. The OS backlog is not an application task queue. The query cancellation budget supplies the remaining semantic deadline to each queued provider call; transport deadlines take the shorter bound. Results past 60 seconds are discarded.

Submission requires the independent scope and never performs local approval or note application. It quotes escaped client text in an unverified inbox block, adds an opaque receipt/client/UTC timestamp and treats provenance as inert text. Parent creation is forbidden for MCP append; setup can review missing directories locally. Receipts are durable before append and reconciled by before/after hashes, with no replay after uncertain outcomes. Native-client and adversarial test evidence is recorded separately in PROGRESS.md; this document alone does not close interoperability or security gates.

Each stateless request owns its SDK runtime/tasks. The adapter consumes one bounded complete response envelope and tears down residual SDK tasks rather than waiting for SSE channel EOF. This prevents a completed fast response from depending on an upstream channel-close notification.
