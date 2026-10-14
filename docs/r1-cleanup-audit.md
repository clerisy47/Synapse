# R1-T01 scope cleanup audit

Audited the current SPEC, DESIGN, PLAN, AGENTS and PROGRESS before editing. The working tree already contained scope revisions in those documents, README and the M1 checklist, plus edits to constants, settings migration/tests, UI strings and the live OpenRouter test, and untracked historical snapshots. Those changes were retained; no commit or reset was performed. Historical snapshots are not active requirements.

The cleanup was divided into these review groups:

| Group | References audited | Result |
|---|---|---|
| Probe and tooling | PDF probe adapter/export, standalone spike/manifest/fixture generator, Gate B runbook, build entry points, dependency rules | Removed the probe and its command/build instructions; removed obsolete module rules. Production still builds only src/main.ts. |
| Model/config/state | Claim extraction and comparison schemas, queue kinds, feature defaults/bounds/clones, constants, dismissal/daily-run state | Removed retired operations/settings/state. Health and Q&A remain; interactive Q&A takes priority over health. The schema checker requires the exact four current operations and retains all keyword restrictions. |
| Markdown retrieval/citations | Vault binary port/adapter/fakes, PDF metadata/status/source kinds, corpus branches/counts, tools, evidence locators, navigation, chat labels/errors | Markdown-only ingestion and navigation; no page arguments or citation labels. Replaced graph/recent/frontmatter PDF fixtures with Markdown notes. |
| Coverage and active docs | Exclusion, corpus, ledger, navigation, settings/state tests; README/checklist/manifest and Phase 0 research | Preserved search/chat/evidence/exclusion/queue tests. Added migration and binary-rejection coverage. Removed unused date-field resolver scaffolding (no production callers); preserved its tag/title tests in metadata-indexes.test.ts. Archived original engineering research under docs/history and retained a pointer. |

Remaining retired-name references in implementation are deliberate state migration suppression keys. Test references exercise migration or rejection of non-Markdown content. Release-scope documents explicitly list removed features as non-goals. Generic queue pumping and state-save debounce remain; neither schedules daily model work. User activity and touch history remain because list_recent uses them. Chat answer claims and citation verification remain because cited chat requires them. The existing transport fixtures and provider settings were retained; no local Ollama work was started.

No research, MCP, policy-control-file or note-application features were implemented. OpenRouter default/live model remains openrouter/free. Existing network and vault-write allowlists were not widened.

Validation: typecheck, lint (0 errors, 6 existing warnings), boundaries, network/write/schema checks, 399 passing tests (1 optional live test skipped), production build and git diff --check. Injected-host smoke covers load without a key, chat command/ribbon, model failure and unload; the production bundle was also loaded with legacy state in an injected host and its chat mounted/unmounted. These checks do not establish real Obsidian behavior.

Manual follow-up in a synthetic Obsidian vault: reload the three plugin artifacts, open chat via command/ribbon, confirm Markdown-only retrieval and exclusion behavior, click a verified passage and confirm exact selection/scrolling (including a stale passage), and check unload/reload. Live provider latency/availability was not measured for this cleanup; the optional live test was left opt-in and no alternate model was used.

Delivery validation: all automated checks were rerun successfully (399 tests; one optional live test skipped). Historical snapshots retain their original Markdown whitespace byte-for-byte; diff whitespace validation excludes only those archived documents. Real Obsidian smoke evidence remains pending.

Operator evidence (2026-10-14): the user confirmed that real Obsidian load/unload, chat command/ribbon, Markdown retrieval/exclusions, and exact/stale passage citation behavior pass in response to the delivery smoke checklist.
