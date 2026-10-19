# Deterministic retrieval coverage checkpoint

These synthetic Rust regressions preserve the six categories that failed in the
larger-vault evaluation. They contain no original note content. The ten original
prompts remain unchanged in Synapse-Test-Vault/Test Queries.md, and their baseline
reports and evaluation runner remain unchanged.

Reproduce: `cargo test --locked -p synapse-core --test coverage`.

Initial checkpoint before retrieval changes: **1/7 passed; 6/7 failed**. Leakage,
numeric examples, chronology, regularization and hiking lost required facts;
the two-note comparison ranked question repetition above factual evidence.
The checkpoint ran all tests normally: no ignored or expected-panic tests.

Rubric:

- Relevance: a passage addresses a queried topic. Titles, links and repeated
  questions establish discovery only.
- Correctness: every citation must reproduce the exact contiguous source lines
  with valid one-based coordinates and application-owned sequential IDs.
- Completeness: each required fact must occur in a passage from its designated
  source; comparisons need both sources, numeric examples need both values,
  and bounded lists need every requested item including the tail. Tests do not
  compare generated prose or require one answer wording.
- Appropriate abstention: no measured accuracy or marine-biology duration is
  supplied in the unsupported fixtures. Relevance must not count as sufficiency.
  Live/provider sufficiency and abstention remain separate qualification gates.

The deterministic model adapter selects all supplied evidence IDs. Consequently,
checking facts again on returned sources verifies that the facts survived the
actual SelectEvidence job input; it does not evaluate a real model's judgment.
Exact citation checks run at both retrieval and chat boundaries. This is offline
retrieval/packing evidence, never a claim of live Bonsai answer quality.

## Implementation checkpoint

T11–T13 now retain the required fixture facts in retrieval and the actual model
job input without increasing the 1,400-byte evidence allowance, 4,096 context or
three-call ceiling. Twelve coverage tests exercise the original six categories,
exact citations, topically relevant but numerically unsupported selection,
partial checklist/comparison refusal, Unicode/link-window retrieval, access and
stale-byte invalidation, and explicit indivisible-window overflow.

Retrieval uses bounded overlapping windows starting at headings and paragraph,
list and table boundaries. Body terms and adjacent phrases rank independently
of metadata discovery; heading context retains parent sections. Generic query
words are removed. Question-only/navigation windows cannot outrank factual
passages. Candidate memory is bounded to 32 retained windows per note and 256
ranked windows globally; at most eight are returned, diversified by note. Each
citation remains contiguous and bounded to six source lines/1,200 characters.
Link expansion uses ranked question-specific windows with fresh access/bytes.

Packing keeps whole windows; oversized windows cannot silently lose their tail.
No-fitting-window overflow is explicit. Source bytes/access are verified before
each selection request and again after selection/before output. The provider
checks a conservative whole-request byte allowance including schema/output
reserve, in addition to the existing local rendered-template/tokenizer check.
The strict prompt now demands all material facts. Additional application checks
refuse missing numeric support, absent comparison subjects and incomplete bullet
lists, but these are necessary constraints, **not general semantic entailment**.
T14 remains open for broader sufficiency and live-provider evidence. Counts-only
metadata guidance is implemented on stderr; JSON v1 remains unchanged. T15 still
needs the required new real-PTY metadata repair qualification.

The first real-vault attempt and its unrestricted retry both returned
`provider_unavailable` for every model request. Reports are preserved as
vault-retrieval-iteration-run1-2026-10-19.json and
vault-retrieval-iteration-run1-unrestricted-2026-10-19.json. Each passed 10/21
cases, all deterministic/non-model checks, and failed the eleven model-dependent
cases. These are availability failures, **not quality scores**. Original and
prepared-copy mutation hashes remained unchanged. No runtime was started or
installed, no remote fallback was used, and no original metadata was repaired.
The original ten prompts and baseline reports remain unchanged.

Remaining work: extend T14 coverage beyond these conservative English-language
constraints, finish T15 real-PTY repair evidence, then run T16's three independent
local quality runs, privacy/native-MCP/live-terminal checks and latency rubric.
The unavailable user-managed Bonsai service prevents that live qualification.
No release publication is authorized or performed.

Final offline verification: 64 deterministic Cargo tests passed, one opt-in
Bonsai test ignored. `cargo fmt --all -- --check`, `cargo check --locked
--all-targets`, `cargo clippy --locked --all-targets -- -D warnings`,
`cargo test --locked`, `cargo build --locked --release`, capability allowlists,
real non-live terminal/review PTY scripts and standalone archive/install smoke
passed. The archive was built with scripts/package-rust.py and checked with
scripts/test-rust-package.py. No live terminal/model/native-MCP quality claim is
made for this checkpoint.
