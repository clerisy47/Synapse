# Active control and access contracts

Revised 2026-10-17: Security.md support is removed. Earlier policy audit documents
record historical implementation, not current requirements.

## Vault files

The configurable defaults are `Synapse/Instructions.md` and `Research.md`.
Paths are canonical vault-relative Markdown paths and cannot collide. Both are
excluded from ordinary retrieval. Research explicitly reads instructions and its
selected inbox batch. Setup proposes only missing instruction starters and never
overwrites existing files. Search/chat need no control files.

Instruction frontmatter supplies version 1, IANA timezone, destination IDs/paths,
and daily routing. Routing constructs canonical paths; ambiguous dates are
rejected. Prose guides formatting without granting access or approval.

## Fixed access boundary

The implementation owns a fixed access snapshot. Non-excluded notes are eligible
for the selected provider. OpenRouter needs explicit selection/consent; there is
no fallback. MCP needs local enablement, authenticated pairing and independent
query/submission scopes. Query scope covers non-excluded notes; submission may
append only to the configured research inbox. Clients cannot approve note edits.
No user-authored per-recipient grants or configurable masks remain. Legacy
security-path settings are ignored; existing vault files are not modified.

Read sessions still bind source/metadata generations and enforce exclusions,
control-file privacy, capability checks and stale-response rejection. Existing
rule/projection helpers are internal compatibility infrastructure, with no vault
file or settings entry point.

## Reviewed writes

Research requires valid instructions, source snapshots, plugin-owned destination
and evidence IDs, bounded Markdown, and local review. Exact approved changes bind
source/target/instruction hashes and a fixed access-contract version hash. The
legacy `policyHash` field stores this implementation version for journal format
compatibility; it no longer hashes Security.md. Old approvals have no persisted
authority. Changed sources, targets, instructions, settings or exclusions require
renewed review. Unsaved edits and cancellation block application.

Only the restricted adapter creates/updates Markdown. Instructions and inbox are
rejected as destination targets. Recovery preserves approval-free history; revert
requires a new diff and approval. Clearing plugin data preserves every vault file.
