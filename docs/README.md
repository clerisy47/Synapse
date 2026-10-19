# Documentation map

Current baseline, rewritten 2026-10-18 for the native Rust/Cargo terminal platform; native implementation and evidence are maintained here:

- [Product specification](../SPEC.md): behavior, privacy and approval boundaries.
- [Architecture](../DESIGN.md): terminal, application ports, filesystem and process design.
- [Plan](../PLAN.md): authoritative implementation status and dependencies.
- [Progress](../PROGRESS.md): handoff and known gaps.
- [Engineering research](../RESEARCH.md): decisions requiring investigation/evidence.
- [Rust foundation and superseded scaffold](cli-scaffold.md).
- [Workspace controls](control-contracts.md), [Bonsai runtime](bonsai.md), [MCP contract](contracts/mcp-v1.md), and [release validation](release-validation.md).

Obsolete host audits, deployment guides and historical specifications were removed as part of the product pivot. Git history retains prior versions. No CLI acceptance evidence is claimed from those documents.

The subsequent user request to complete PLAN authorized implementation. Native qualification evidence is recorded in [the evidence report](evidence/native-qualification-2026-10-19.md). Existing npm/TypeScript tooling is historical and does not validate Rust readiness.

See [review/recovery](rust-review.md), [native installation](native-install.md) and [dependency/license review](rust-dependencies.md) for operational limits. Publication remains separately authorized.
