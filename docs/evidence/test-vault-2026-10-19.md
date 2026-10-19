# Synapse-Test-Vault evaluation — 2026-10-19

User-requested evaluation of the current native Rust CLI against the fictional Synapse-Test-Vault. The original workspace is never repaired or written by this evaluation. The runner hashes every original file, including hidden application files, before and after execution. Isolated temporary HOME prevents legacy-state import and keeps evaluation state outside the workspace.

Reproduce with:

```sh
cargo build --locked --release
python3 scripts/test-rust-vault.py target/release/synapse Synapse-Test-Vault docs/evidence/test-vault-2026-10-19.json
```

The runner requires the user-managed local Bonsai service. It never starts/downloads a model or requests OpenRouter. A nonzero exit indicates failed assertions; individual cases continue and their outcomes are retained. The JSON report contains fictional fixture passages for inspection, not diagnostic output.

The original 19 Markdown files have no required frontmatter. Four original-vault keyword checks therefore correctly return insufficient evidence. This is compatibility evidence, not successful retrieval: normal questions cannot use this vault as supplied. Reviewed metadata repair is required for use with the current product. The remaining tests use a disposable Markdown-only copy with valid description/tags/aliases added, preserving every original body. No original hidden plugin state is copied. Test Queries and Home are included in the copy, so search results may legitimately include those notes.

All ten documented questions run against that prepared copy. Assertions check requested facts and relevant source paths, versioned JSON, process exit, exact source line coordinates/text, sequential citation IDs, and absence of question/source text in stderr. Four keyword checks exercise leakage, threshold, fermentation and navigation. Three exclusion checks cover explicit folder and tag settings. Both original and prepared workspaces must remain byte-identical after queries.

Initial harness findings are preserved in test-vault-initial-2026-10-19.json. That report has false failures caused by stripping trailing blank lines during citation comparison and assuming excluding Everyday would also eliminate the permitted Test Queries search match. The final runner compares exact citation text and checks excluded-path absence; these corrections do not relax quality assertions. Initial report failures must not be counted as product citation/exclusion defects.

Code inspection identifies a retrieval limitation: Corpus::query selects the first matching line and the following five lines, with one passage per candidate note. Title matches can therefore select an introduction rather than a later requested fact. ChatSession marks any selected nonempty source set answered. Valid citations establish byte authenticity; they do not establish that the passage answers the question. The final report records which quality assertions fail and retains returned passages for review. No product behavior has been changed in this testing task.

Independent verification passed: all 51 deterministic Cargo tests (one opt-in live fixture ignored), Cargo format/compiler/Clippy, capability-boundary checks, locked release build, real PTY terminal lifecycle, and real TTY review/preview checks. These generic checks complement the vault evaluation; they do not compensate for its quality failures. No live remote, MCP, packaging or cross-platform qualification was repeated for this task.

Local `/props` observation during evaluation: runtime build `b10777-e3de71522`, one slot, default context 4,096, and model path indicating PQ2_0. This confirms those reported settings, not independent weight authenticity.

Final outcome: **15/21 cases passed**. All four original-metadata eligibility checks, four prepared keyword checks, and three exclusion checks passed. Of ten documented questions, **4/10 passed**: hydration, database indexes, unmeasured accuracy and unsupported marine biology. Six failed requested-fact coverage: leakage timing, logistic/forest comparison threshold, numeric precision/recall, chronological splitting, early stopping and the full hiking checklist. All returned citations passed exact text/coordinate validation. Both workspace hash comparisons passed. An answered result must not be interpreted as complete question coverage on this evidence.

Next steps supported by these results: rank multiple body windows per note using query relevance, avoid letting title matches pin passages to introductions, and evaluate sufficiency against the requested detail before returning answered. Preserve the ten-question quality assertions as regressions when implementing those changes. Metadata compatibility is a separate usability issue; the original vault requires a reviewed repair, which this task does not apply.
