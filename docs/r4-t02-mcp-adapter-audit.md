# R4-T02 local MCP adapter

The shipped adapter implements the JSON-only subset of the pinned
[MCP 2025-11-25 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).
It uses Node HTTP directly, with no SDK, sessions, SSE or outbound requests.
Native-client interoperability and actual Obsidian UI testing remain R5-T03.

## Local controls and durable credentials

The settings panel defaults to a disabled listener and unchecked independent query
and submission scopes. Pairing explicitly confirms the selected scopes, permits no
scopes, and shows a random 32-byte base64url bearer once. Closing/repainting the
settings panel or hiding the bearer removes its visible value. Losing a bearer
requires revocation and a new pairing; scope changes likewise require revocation
and new pairing. Client labels render as literal text.

`mcp-grants.json` resides under StoragePort in the plugin folder, separate from
ordinary settings. It contains the enabled flag, strict bounded client grants,
SHA-256 bearer digests and authority generations. No plaintext bearer is persisted
or included in status. Hashes use constant-time fixed-length comparison. Malformed,
unreadable or unwritable grant storage fails closed. A missing file is the
normal disabled first-run state. Persistence failure closes the listener and
requires repairing storage and reloading; no automatic recovery enables it.

Revocation removes a grant immediately and invalidates pending work before durable
success. Revoked identifiers are never reused. Other client work is conservatively
invalidated too. A new pairing gets a new random identity and starts at generation
zero. Policy/source changes clear initialization and abort active work. Plugin
settings changes disable and close the listener, persisting that disabled state;
enable again locally afterward. Unload closes sockets and suppresses late bootstrap
results. Durable enabled grants resume on a normal plugin restart.

## Transport surface and bounds

Only `src/adapters/node/mcp-server.ts` joins the network allowlist. Binding is fixed
to OS-assigned IPv4 loopback with exact `/mcp`, Host and bearer checks. Every Origin,
forwarded headers and duplicate authority headers are rejected. Authentication
precedes JSON parsing. GET/DELETE are unsupported; no browser CORS is enabled.

Initialization returns only tools capability and pinned version. Initialized
notifications, ping, scope-filtered tools/list, strict tools/call and cancellation
are supported. Missing/unsupported subsequent version headers, JSON batches,
unknown envelope fields, unsafe IDs, unknown/unscoped operations and malformed
arguments fail with fixed public responses. Query and submission arguments have
strict independent schemas; URLs are inert provenance and are never fetched.

Injected constants bound headers, streamed UTF-8 body bytes, timeouts, per-client
request rates, global unauthorized traffic, clients, concurrent body readers,
semantic work and output. Work deadlines include body-read time. Cancellation,
disconnect, revocation and shutdown abort active work and suppress late delivery.

R4-T02 intentionally returns fixed `unavailable` for valid scoped semantic calls.
There is no model, vault-query, note-write or inbox-append authority composed here.
R4-T03 must implement recipient policy, safe responses/references, JobQueue work
and durable idempotent inbox append before those operations become functional.

## Evidence

- Integration coverage exercises the shipped adapter over real synthetic loopback
  HTTP: initialization, scopes, protocol errors, malformed storage, persistence
  failure, restart, revocation during active work, cancellation, deadlines,
  concurrency, Unicode/byte/header/rate bounds and slow bodies.
- DOM tests cover explicit scope confirmation, inert labels, one-time credential
  display and late pairing completion after settings close.
- Plugin host tests enable the composed listener and verify unload closes it.
- Typecheck, lint (warnings only), boundaries, network/write/schema gates, complete
  deterministic suite (820 passing; one optional live test skipped), 83 mini-vault checks and production build pass.
- No live provider request, real user vault content, real Obsidian smoke or native
  MCP-client interoperability is claimed by these headless tests.
