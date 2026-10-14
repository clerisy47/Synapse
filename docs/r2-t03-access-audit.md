# R2-T03 runtime access audit

## Delivery plan

Implement sequential slices: (1) runtime recipient decisions and pure masking;
(2) access-bound tool dependencies; (3) private evidence and safe prompt/result
projections; (4) composition, history provenance and synchronous invalidation;
(5) payload/leak integration tests, full checks and production-host smoke.

Keep raw source paths and offsets private to retrieval/verification. A representation
that cannot enforce a mask must deny access. No network/write allowlist expansion,
MCP transport or note application belongs to this task. All model work remains
queued; default/live provider is OpenRouter openrouter/free.

## Validation

- 611 tests pass; one pre-existing opt-in live OpenRouter test remains skipped.
- Typecheck, lint (zero errors, eight existing warnings), boundaries (178 modules),
  network/write/four-model-schema checks, production build and whitespace pass.
- All eight tools cover internal, remote-model and external-client contexts,
  denial before limits, safe graph counts, missing/denied parity and unsupported
  raw masks. Policy contracts preserve folder/tag/metadata/deny/capability cases.
- Mock HTTP payloads exercise all field removals, literal masks, injection, fresh
  versus stale/unprovenanced history and forged-citation retries. Private original
  citations still verify. Access changes at each model phase discard results.
- Physical provider retry tests cover schema-invalid, HTTP 503 and successful late
  responses with non-abortable transport; stale access never sends another request.
- Runtime tests cover synchronous source/policy invalidation, dirty metadata,
  disagreement with cached fields, internal counts and listener disposal. UI tests
  cover provenance, clearing retained/pending state and detached citation buttons.
- Production bundle injected-host smoke: ready-policy/no-key chat failure, immediate
  clearing on a security edit, invalid-policy denial and full unload/listener cleanup.
  The initial harness lacked Obsidian's createDiv method; using the repository Notice
  stub corrected the harness. No product change was needed for that harness issue.
- No live model request, real-vault write or real Obsidian UI verification was performed.

## Interfaces and deliberate limits

See the runtime section in [control contracts](control-contracts.md). Read sessions,
policy/source generations and provider request guards are local trusted interfaces;
provider output schemas and release artifacts are unchanged. Raw tools deny masks
that their path-based representation cannot enforce; safe evidence projections
support all frozen actions. Cloud Q&A results remain internal UI objects with
original citation anchors, not externally serializable responses. The MCP facade
and restricted write adapter remain their scheduled tasks.

Literal rules are applied conservatively to free text across the recipient's mask
rules; field-value removal is conservative across known masked notes. Either may
over-mask. Any vault/metadata event invalidates the entire chat rather than trying
to preserve unverifiable derived claims. No persistent history migration is needed.
