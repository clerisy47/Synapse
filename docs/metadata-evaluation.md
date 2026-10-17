# Mandatory metadata evaluation — R8-T01

Measured 2026-10-17 on the synthetic project mini vault; no user vault was migrated or read. Metadata is mandatory independently of these results.

The baseline fixture `test/fixtures/pre-metadata-search.ts` freezes the search implementation from commit `74c2df2`, retaining the already-delivered paragraph window behavior from the starting working tree. Baseline FakeCorpus reproduces pre-contract ingest: every eligible Markdown note participates, with existing alias/tag indexes. The revised side uses production CorpusStore and tools. Both use the same note bodies, limits and seven literal search requests. No extra search index was introduced. The fixture README also lacks metadata and is correctly reported alongside the intentionally missing-metadata note (two repair items).

Reproduce deterministic discovery/context measurements:

```sh
npx vitest run test/integration/metadata-evaluation.test.ts
```

| Synthetic case | Before: expected body fact retrieved | After | Result |
|---|---|---|---|
| Ambiguous `01.md`, useful alias | No | Yes | Alias discovery reaches current body |
| Ambiguous `02.md`, useful alias | No | Yes | Alias discovery reaches coordinator fact |
| Description-only subject/scope phrase | No | Yes | Searchable description selects body |
| Tag-only discovery term | No | Yes | Tag discovery selects body |
| Body keyword with stale description competitor | Yes | Yes | 1 → 3 candidates; more noise |
| Missing-metadata backup note | Yes | No | Required exclusion reduces recall until repair |
| Misleading Sunday description | No supported fact | No supported fact | 0 → 1 irrelevant candidate; body does not support Sunday |

Across six answerable searches, expected body-fact recall was 2/6 before and 5/6 after. This is small deterministic discovery evidence, not an overall answer-quality improvement claim. The seventh unsupported case must never be treated as a supported Sunday answer. Every returned excerpt matches current full-file body offsets and excludes YAML.

Seven tool calls on each side. Serialized candidate contexts: **683 → 3,723 characters**, estimated **217 → 1,167 tokens** using the project's estimator. These are tool-result estimates, not provider billing or full model context. Richer results and false-positive descriptions increased context use; there was no tool-call saving. Latency was not assessed by this deterministic fake-clock comparison.

Initial revised measurement selected alias/description/tag notes but returned only their opening headings: expected body-fact recall remained 1/6 after excluding the missing note. Fixed metadata-only discovery to return a bounded opening body window; retained body-fact assertions. Initial revised failure is recorded here rather than presented as an improvement.

The same running user-managed Bonsai server at numeric loopback 127.0.0.1:18080 passed a controlled live before/after comparison. Fixed search terms and deterministic top-k selection isolate retrieval; only answer generation is live. It does **not** evaluate free model planning. Each run recorded two logical pipeline model calls: one scripted planner and one physical Bonsai answer call; one search tool call, zero separate read_note calls (search supplies body evidence).

| Case | Before | After | Prompt tokens before → after | Output tokens | Active time (s) |
|---|---|---|---|---|---|
| First alias | Insufficient | Correct, body-sourced | 241 → 267 | 26 → 64 | 4.221 → 4.712 |
| Second alias | Insufficient | Correct, body-sourced | 239 → 263 | 26 → 58 | 2.642 → 4.304 |
| Unsupported Sunday | Insufficient | Insufficient | 247 → 281 | 26 → 26 | 2.647 → 2.779 |

All emitted claims resolved to current body citations; the unsupported case emitted none. Context and latency increased. One run per case provides no stable latency estimate or broad quality claim. Production queued metadata generation also passed in **5.782 s**, with schema-valid relevant description/tags, body preservation and zero writes. Alias semantic usefulness still requires exact local review.

```sh
SYNAPSE_LIVE_BONSAI=1 npx vitest run test/live/bonsai-metadata.live.test.ts test/integration/metadata-evaluation.test.ts --no-file-parallelism
```

The first migration is deliberately one-note-at-a-time. Existing blank/malformed metadata and notes over 6,000 characters need manual editing; stale/misleading but structurally valid descriptions are not automatically detected or rewritten. Migration has ephemeral approval and no plugin-managed recovery/revert journal; unknown write outcomes require inspecting the note before another audit. Search/chat do not require control files.

Actual Obsidian repair-view review/apply, background-editor conflicts in the real host, reload/index refresh and native authenticated MCP-client smoke remain pending under R5-T03/R5-T04/R6-T02. No release gate was closed and no plugin deployment or runtime launch/download was performed.


Final narrow live recheck also passed all three tests. Answer/citation outcomes and reported token counts repeated; alias active times were 3.641 → 4.645 s and 2.567 → 4.351 s, unsupported Sunday 2.613 → 2.819 s. The second no-write metadata proposal passed in 4.270 s. These two narrow runs do not establish stable latency or a general quality gate.

Automated verification: 959 tests pass, 11 opt-in cases skip in the ordinary suite; all required type/lint/boundary/network/write/six-schema checks and production build pass. Lint has 28 warnings and no errors. Nine built-bundle injected-host load/chat/research checks pass. These remain headless/injected-host evidence.
