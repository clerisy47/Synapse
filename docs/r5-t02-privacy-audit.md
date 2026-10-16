# R5-T02 privacy and clear-data audit

Goal: erase owned plugin history while preserving settings and user files, disclose sensitive persistence/egress, and remove sensitive diagnostics.

Implementation slices:
1. State: wrap StoragePort mutations with a freeze/drain barrier; clear only recovery, MCP receipt and grant files, reset data.json to empty state with exact current settings, and scrub the current state object.
2. UI: local confirmation names recovery/revert and duplicate-prevention losses, pairing loss, retained API key, sync/backups and required reload. Cancel/unload has no erasure effect; late clicks cannot approve.
3. Composition/diagnostics: stop services, invalidate chat and close review surfaces before erasure; static console events omit exception objects; debug notices omit paths. Wire through public module exports.
4. Validation/documentation: exercise pending persistence, failure, confirmation/cancel/unload and production composition/restart; disclose OpenRouter routed-provider context and retention.

Constraints and risks: no vault write or arbitrary recursive deletion is involved. A storage failure can leave partial erasure and is reported generically; reload and retry. Persistence remains frozen after success or failure until reload. Clearing intentionally loses duplicate-prevention history; repeated research or MCP submissions can be processed again. Existing synced copies/backups are outside this command. A previously approved host write already in flight cannot be rolled back by clearing data.

Persistence inventory: data.json holds settings (including configured API key), bounded research ledger and touch history. recovery.json holds full target before/after text, capped at 20 records/4,000,000 characters; resolved records expire after 30 days on access, unresolved records remain. mcp-receipts.json holds bounded receipt hashes and inbox paths with 30-day retention and unresolved intent preservation. mcp-grants.json holds hashed bearers and capability grants until revoked/cleared. Chat/proposals are memory-only. Synced old state can reappear through a later external sync; this is not a sync tombstone or backup purge.

Validation: full suite 853 passed, one existing opt-in live test skipped; 88 mini-vault checks passed. Typecheck, lint (warnings only), boundaries, network/write/schema checks and production build passed. Production bundle research/plugin tests passed, including clear/restart and sensitive initialization-error redaction. Real Obsidian UI/load smoke and live openrouter/free evaluation remain at R5-T03/R5-T04 per PLAN.
