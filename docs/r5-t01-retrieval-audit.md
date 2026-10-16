# R5-T01 — Iterative retrieval and multi-turn chat

The existing bounded state machine already permits one revised-term search after an insufficient answer. The pipeline now also handles phrase-only follow-ups by deriving the required search term from the first phrase, retaining the exact phrase filter.

Graph expansion previously counted links/backlinks calls but discarded their references. It now follows plugin-owned permitted references through guarded `read_note` calls, adds their Markdown excerpts to the current ledger and selector candidates, and counts these reads against both hop and read limits. Graph reads consume the remaining selection read allowance; zero read budget prevents graph reads. Existing duplicate tracking, elapsed-time limits and access guards remain active. Exhausting a hard hop limit can conservatively end the run as insufficient.

Current-policy history filtering existed at planning. Selection and answering now receive the same sanitized, version-bound last three Q/A pairs, including verification retries. Historical responses are conversational context only; current retrieved evidence supplies citation IDs. Every turn starts with a fresh ledger and retrieval. Legacy/unprovenanced and stale-policy turns are omitted. Production composition invalidates retained chat on corpus/policy rebuilds.

## Verification

- Mock OpenRouter HTTP fixture starts with an empty search, receives an insufficient answer, performs a revised search and answers from newly retrieved evidence. Both term and phrase-only follow-ups are covered.
- Linked-note fixture verifies a graph-derived current Markdown citation and bounded read/hop accounting; zero-budget fixture verifies no graph read.
- Recipient fixture checks current sanitized history in every provider request and suppresses stale/unprovenanced history. Existing mid-call policy invalidation tests remain green.
- Forged IDs retry once and remain unverified if unresolved; vanished passages are unverified. Existing UI navigation tests ensure only sourced citations invoke navigation with plugin-owned exact passage data.
- Typecheck, lint (existing warnings only), dependency boundaries, network/write/schema checks, full tests (844 passed, one opt-in live test skipped), mini-vault suite (88 passed), and production build passed.

No live model call was needed for these deterministic fixtures. Actual Obsidian passage selection and multi-turn/MCP workflows, plus live `openrouter/free` evaluation, remain at R5-T03 under the current execution rules.
