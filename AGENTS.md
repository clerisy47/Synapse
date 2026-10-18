# AGENTS.md — Synapse

Standalone terminal platform for agentic Markdown workspace search/chat, locally reviewed research-to-note updates and scoped MCP collaboration. No embeddings, vector DB or telemetry. User revision 2026-10-18 supersedes all application-host requirements. The new CLI is not implemented. Reuse logic if useful; there is no requirement to preserve existing code. This pivot session is documentation-only; do not migrate code without a subsequent implementation request.

Read [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md). These are the current baseline; old implementation results do not prove CLI readiness.

## Task selection and reporting

User-directed revisions take precedence. Select the IN_PROGRESS task in PLAN; otherwise the lowest-ID TODO with DONE dependencies. If none qualifies, stop and report blockers. Update status only in PLAN.md; PROGRESS.md is narrative. Never claim gates complete without evidence.

Commit format: `[type]: [summary] (task [ID])`; types feat/fix/refactor/test/docs/chore/build. Wait 30 seconds before retrying the same failed problem; stop after 10 failed attempts and report evidence and suggested next steps. Preserve unrelated working-tree changes.

## Implementation rules

- Strict TypeScript, ports-and-adapters. Node/filesystem/network/terminal libraries only in adapters or the terminal presentation boundary as specified in DESIGN. Domain/features use ports; modules expose index.ts. Entry point is composition only.
- One explicit canonical workspace per process. No home-directory scans, absolute/traversing note paths, symlink descendants or out-of-root access. Exclusions apply before ingest and at every tool/model/proposal/MCP output boundary.
- All model work through one JobQueue; coordinate local single-slot use across processes. Strict structured schemas and provider-specific builders. Models return bounded values and trusted destination/evidence IDs, never trusted paths, regex, quotes, grants or approvals.
- Runtime default: Bonsai 2 9B PQ2_0 via user-managed PrismML llama.cpp, numeric loopback 127.0.0.1:18080, 4,096 context, one slot, thinking disabled. Never download/start on launch. OpenRouter requires explicit selection and remote disclosure consent. No silent fallback; Ollama is not a substitute.
- Network only in allowlisted provider transports and explicit authenticated loopback MCP listener. No generic network/shell tools, telemetry or automatic URL fetching.
- Application state only through StateStore outside the workspace. Secrets via environment/OS credential adapter. Markdown mutation only through restricted approved-write, reviewed setup or scoped inbox-append ports. No delete/rename of user notes, autonomous application or model/MCP control-file edits.
- Exact local diff approval and explicit Apply bind current workspace, source/target bytes, instructions, exclusions and access configuration. No persisted approval, blanket yes flag or approval from piped stdin. Recheck before each write; journal intent and reconcile uncertain writes rather than retry blindly. Revert requires fresh review.
- Terminal renders untrusted text with control/escape sanitization. JSON output is versioned; stdout stays machine-readable and progress goes to stderr. Ctrl-C cancels work, restores the terminal and reconciles any begun write.
- Configurable Instructions.md and Research.md defaults are defined in SPEC. Never overwrite on setup. Search/chat need no control files. No Security.md feature or authored recipient grants/masks.
- MCP is disabled by default and independently scoped/authenticated. Clients may query permitted evidence or append unverified research, never approve/apply changes. Synapse cannot constrain separately granted filesystem access.
- Keep UI strings separate from logic and provisional limits in named constants/settings. Diagnostics never include note text, prompts, excerpts, credentials, raw errors or paths; sanitized intentional source/diff display is separate. Diagnostic paths use `h:` plus eight SHA-1 hex characters.

## Commands and verification

Current npm commands still target the former implementation. Do not describe their outputs as CLI artifacts. CLI-T01 must establish build/dev/test/lint/typecheck, boundary/network/write/schema checks and clean executable installation. Until then, inspect package.json before running existing checks and describe their limited scope accurately.

Tests colocate with modules; shared fixtures/integration live under test/. Use meaningful temporary-filesystem, subprocess and PTY checks; no test weakening/deletion to pass a rewrite. Never hand-edit generated artifacts, commit secrets or real note content, or claim live-model/terminal/client gates based on mocks. No sub-agent delegation unless explicitly requested by the user or applicable instructions.

## Definition of done

Meet task acceptance, update PLAN, record material findings, pass relevant tests/static boundary/privacy checks and standalone build/install smoke once available. Real terminal, local Bonsai quality and native MCP interoperability require separate evidence. Publication requires explicit user authorization; packaging alone does not close release gates.
