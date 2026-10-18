# Documentation map

Current baseline, rewritten 2026-10-18 for the native Rust/Cargo terminal platform; Rust implementation is pending:

- [Product specification](../SPEC.md): behavior, privacy and approval boundaries.
- [Architecture](../DESIGN.md): terminal, application ports, filesystem and process design.
- [Plan](../PLAN.md): authoritative implementation status and dependencies.
- [Progress](../PROGRESS.md): handoff and known gaps.
- [Engineering research](../RESEARCH.md): decisions requiring investigation/evidence.
- [Rust foundation and superseded scaffold](cli-scaffold.md).
- [Workspace controls](control-contracts.md), [Bonsai runtime](bonsai.md), [MCP contract](contracts/mcp-v1.md), and [release validation](release-validation.md).

Obsolete host audits, deployment guides and historical specifications were removed as part of the product pivot. Git history retains prior versions. No CLI acceptance evidence is claimed from those documents.

The native Cargo foundation is implemented. Existing npm/TypeScript tooling is historical and outside native CI/artifacts. See foundation decisions and PROGRESS for evidence and remaining feature gates.
