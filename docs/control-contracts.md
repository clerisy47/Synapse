# Workspace controls and access contracts

Target Rust terminal behavior; implementation pending. Rust port traits and typed review snapshots must enforce these boundaries; serialization or model output cannot create write authority. Normative requirements are in SPEC.md.

The configurable defaults are `Synapse/Instructions.md` and `Research.md`, distinct canonical workspace-relative Markdown paths. Neither enters ordinary search/chat retrieval; search/chat work without them. Setup reviews only missing starters and never overwrites existing files. No Security.md or user-authored permission grants/masks.

Instructions use versioned deterministic routing metadata: IANA timezone, destination IDs/paths and daily folder/name/heading. Prose guides formatting, never permissions. Research resolves trusted IDs to validated paths; ambiguous daily dates require local clarification. Daily-log routing is distinct from the removed daily-resurfacing feature.

Exclusions precede ingest and apply to tools, model context and output. Explicit remote-provider consent is independent of MCP authentication/scopes. Control files, research and model text cannot change these capabilities. Existing frontmatter exclusions must remain recognized during transition.

Review approval binds exact before/after bytes and the current workspace, source, target, instruction, routing, exclusions and access snapshots. Fresh checks occur before each file write. Changed snapshots discard approval; restart never restores it. External clients and redirected terminal input cannot approve.

Restricted note application cannot target instructions/inbox. A separately authorized submission port may append unverified research only to the configured inbox. Setup uses its own reviewed capability. Recovery records confer no write authority; revert is a fresh reviewed operation. History clearing preserves all workspace files and configuration and explains loss of recovery and duplicate prevention.
