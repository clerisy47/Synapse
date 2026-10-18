# Synapse

Synapse is a planned terminal-based agent for a local Markdown workspace. It brings a Codex CLI-style conversation and review workflow to searching notes, answering with verified sources, and turning rough research into approved note changes.

No embeddings, vector database, or telemetry. Local Bonsai inference is the default; OpenRouter is an explicitly selected remote option.

## Project state

The product direction changed on 2026-10-18. These documents define the new terminal platform. **The CLI scaffold supports help, version and explicit workspace validation. Product commands are still pending.** The repository retains previous application source and tests for reference; they are excluded from the CLI build and package. There is no requirement to preserve or reuse that implementation; useful algorithms and lessons may inform a clean replacement.

Start with [SPEC.md](SPEC.md), [DESIGN.md](DESIGN.md), and [PLAN.md](PLAN.md). [PROGRESS.md](PROGRESS.md) records the current handoff. Old implementation results do not establish CLI readiness.

## Intended workflow

The following commands describe the proposed interface, not currently available commands:

```sh
synapse --workspace ~/Notes
synapse ask --workspace ~/Notes "What have I learned about decision trees?"
synapse research review --workspace ~/Notes
synapse doctor --workspace ~/Notes
```

The interactive terminal shows retrieval progress, answers with numbered sources and file/line locations, and reviewable diffs. Search and chat work without instruction files. Research uses configurable `Synapse/Instructions.md` and `Research.md`; existing files are never overwritten during setup. Changes need exact local review and explicit Apply. External MCP clients can query permitted notes or submit research with granted scopes; they cannot approve or apply changes.

## Runtime and privacy

Default model: Bonsai 2 9B PQ2_0 through user-managed PrismML llama.cpp at `127.0.0.1:18080`, 4,096 context, one slot, thinking disabled. Synapse will not download weights, launch a runtime, or silently switch providers. See [runtime contract](docs/bonsai.md).

The CLI will operate within one explicitly selected workspace. Exclusions apply before indexing and before any model or MCP response. Local application state belongs outside the notes directory; recovery records can contain note content and require a clear retention and deletion policy. Remote use requires explicit selection and consent.

## Development

Use Node 22 or newer. Run `npm ci`, `npm run build`, `npm test`, and `npm run test:release`. `npm run dev` watches the CLI TypeScript build. `node dist/cli/main.js --help` runs the scaffold. `npm pack --ignore-scripts` packages only the compiled CLI, README and license. The package is private and is not published. Product behavior remains under implementation. See [validation requirements](docs/release-validation.md). MIT license remains unchanged.
