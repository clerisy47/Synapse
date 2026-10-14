# Control and proposal contracts (R2-T01)

This freezes version 1 data contracts. It does not enable control-file loading,
recipient enforcement in existing chat, research generation, approval issuance,
note writes, or MCP. Those integrations remain R2-T02/R2-T03 and R3/R4 tasks.

## Control documents

Default vault paths are `Synapse/Instructions.md`, `Synapse/Security.md`, and
`Research.md`. `validateControlPaths` normalizes separators and rejects path
collisions, including case-only collisions. `validateVaultPath` rejects absolute
paths, traversal, empty or hidden segments, whitespace around segments, control
characters, URI/reserved characters, and non-`.md` note destinations. Folder
selectors use the same validator without the extension requirement. No percent
encoding is decoded. Paths remain case-sensitive for matching; collision and
control-target checks conservatively ignore case. A future adapter must also
check the actual configurable Obsidian config directory and filesystem state.

Frontmatter is parsed by the future loader, then validated as an object using
strict Zod schemas. Unknown fields, unsupported versions and malformed rules
invalidate the document; prose never supplies grants. The repository templates
in `assets/control-files/` use JSON flow syntax, which is valid YAML frontmatter.
They are assets, not permission to create or overwrite vault files.

### Security.md

Required fields: `version: 1`, `defaults`, and `rules`.

`defaults` contains `internal`, `remote-model`, and `external-client`, each
`allow` or `deny`. Defaults apply only to reads. The starter permits internal
reads and denies both disclosure recipients; all writes require explicit rules.
Existing exclusions remain an independent restriction. Provider consent and
transport allowlists remain independent of policy grants.

Each rule has a unique lowercase kebab identifier, `recipient`, `operation`,
`effect`, and `selector`. Recipients are the three default keys. Operations are
`read`, `create`, `update`, and `append-research`. Effects are `allow`, `deny`,
and `mask`.

- Internal operations: read/create/update. A write context must have local
  `apply` purpose. Policy permission alone does not constitute diff approval.
- Remote model operations: read only.
- External client operations: read or append-research only. The trusted
  authentication adapter supplies the client identity and capabilities.

Selectors optionally contain `folder`, `tag`, and `frontmatter: {key, value}`.
All supplied selectors must match; an empty selector matches all otherwise
eligible notes. Folder matching requires a descendant boundary. Tags strip an
optional leading `#` and match the tag or nested children. Frontmatter matching
uses an own property with exact case-sensitive scalar equality; no coercion,
regex, executable expressions, or inherited fields.

Decision order: available/current policy → exclusions/control-file restrictions
→ available metadata → recipient capabilities → matching deny rules → matching
allow rule or read default → matching mask actions. Deny always wins. Masks never
grant access. Missing metadata fails closed. Missing/invalid policy disables
remote disclosure, MCP operations and note application; existing ordinary
internal search continues through its current exclusion checks until R2-T03.
The pure reference evaluator denies any request without a validated snapshot.

A mask rule requires a nonempty `masks` array and `operation: read`; other effects
must omit it. Actions are `{kind: "remove-field", field}` with field `title`,
`path`, `tags`, `frontmatter`, or `aliases`, or `{kind: "replace-literal", from,
to}`. `from` must be nonempty. Consumers union field removals and execute
case-sensitive literal replacements once each in declared rule/action order,
through every disclosed string, including content and identifiers. No regex or
model assurances are accepted. If the receiving representation cannot implement
all required masks, deny disclosure. Removing a reference path requires safe
opaque references later; it does not permit another path-bearing field to leak.

External reads require purpose `query` and `query-vault` capability. Inbox
appends require purpose `submit`, `submit-research` capability, an explicit
append allow, and exactly the configured Research.md path. This exception never
authorizes inbox reads or control-file edits. The inbox service must use its
privileged metadata read, not insert the inbox into the ordinary corpus. An
explicit exclusion still denies the reference decision. Existing note-write
and network bans remain unchanged until their dedicated adapter tasks.

### Instructions.md

Required fields: `version: 1`, `timezone`, `destinations`, and `daily`.
`timezone` is UTC or a validated IANA zone. Each ordinary destination is
`{id, path}` with a unique lowercase kebab identifier and canonical Markdown
path. Case-only destination path collisions are rejected.

`daily` is `{id, folder, filename: "YYYY-MM-DD.md", heading}`. Its ID is distinct
from ordinary destinations; heading is one Markdown heading line. The starter
uses UTC, `Daily`, and `## Log`. `resolveDailyDestination` accepts only an
explicit valid Gregorian `YYYY-MM-DD` date (years 0001–9999), then constructs a
canonical path. It never interprets model paths, locale-dependent dates, or
relative prose. R2-T02 resolves timestamps/relative dates in the configured
zone and invalidates snapshots at file edits; ambiguous choices block approval.
Control-file/inbox targets are independently rejected by proposal validation.

## Snapshots, proposals and approval

Core exports readonly `AccessContext`, `PolicySnapshot`, `InstructionSnapshot`,
`ResearchBatch`, `ProposedChange`, `ChangeProposal`, `ApprovalBinding`, and
`Approval` contracts, with branded content hashes and batch/proposal/destination
IDs. Readonly typing does not authenticate input: snapshots must come from
validated local loaders, IDs from the plugin, and contexts from trusted services.
`AccessContextSchema` validates data shape, not authentication or consent.

Control snapshot hashes are full lowercase SHA-256 over exact UTF-8 complete
file text, including prose and line endings. Schema version and content hash
are separate: an edit changes the hash without changing schema version.

A research batch identifies its source, complete source hash, selected-content
hash, provenance (`local` or `external`) and nonempty half-open UTF-16 offset
range. Proposal data includes version 1, plugin-issued ID, batch, instruction
and policy hashes, changes, and validation issues. Each change includes a
plugin-resolved destination ID/path, create/update operation, target snapshot,
complete before/after Markdown, and evidence IDs. Create requires an absent
target and empty before text; update requires an existing target hash. No
control-file/inbox targets, duplicate target paths, deletion/rename, approval
fields, executable commands, model quotes, or binary destinations are accepted.

`parseChangeProposal` validates the trusted local representation and configured
inbox source. It does not prove that a destination/evidence ID exists, hashes
match the current vault, content obeys instructions, or approval is present.
Those checks belong to generation/review/application services. Never use this
schema as a model-output schema: the plugin alone supplies its trusted fields.
Unresolved validation issues remain proposal data and must block approval.

`hashApprovalBinding` uses stable object-key serialization and a fixed projection
of version, proposal ID, batch source/range/provenance and hashes, instruction/
policy hashes, and exactly the selected changes in displayed order. Each change
binds destination ID/path, operation, target existence/hash, exact before/after
text, and evidence IDs. Array order is significant; text is never normalized.
Any changed selection, content, source, target, or rule snapshot requires renewed
review. SHA-1 remains only for diagnostic path pseudonyms, not approval hashes.

An approval's ID, local-ui issuer and binding hash describe data, not authority.
The future local UI must keep issuance in trusted in-memory state, issue only
for a reviewed valid selection, and consume authority once. No model/client
field or persisted approval object can recreate authority. Application must
recheck current source/target/rules, unsaved buffers and cancellation immediately
before each write. Recovery persists approval-free records only.

## Bounds and diagnostics

`CONTROL_LIMITS` holds provisional tunables: 128 rules, 32 masks per rule,
64 configured destinations, 64 selected changes, 64 evidence IDs per change,
200,000 characters per Markdown before/after value, 64-character IDs,
1,024-character paths/literals, and 200-character headings. These local control
schemas are separate from the unchanged four provider-output subset schemas.

Validation facades return Result values with a fixed message, stable issue code
and schema field location. They never attach supplied values or Zod error
objects. Codes include `CONTROL_SCHEMA_INVALID`, `INVALID_VAULT_PATH`,
`CONTROL_PATH_COLLISION`, `DUPLICATE_RULE_ID`, `INVALID_MASK_RULE`,
`INVALID_RECIPIENT_OPERATION`, `INVALID_TIMEZONE`, `DUPLICATE_DESTINATION_ID`,
`DESTINATION_PATH_COLLISION`, `AMBIGUOUS_DATE`, `INVALID_DATE`,
`PROPOSAL_SCHEMA_INVALID`, `INVALID_SOURCE_RANGE`, `TARGET_OPERATION_CONFLICT`,
`DUPLICATE_TARGET`, `INVALID_CHANGE_INDEX`, `RESTRICTED_PROPOSAL_PATH`, and
`APPROVAL_BINDING_INVALID`. Diagnostics must not log control text or paths;
existing SHA-1 diagnostic path pseudonyms remain unchanged.
