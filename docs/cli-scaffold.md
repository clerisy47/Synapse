# CLI scaffold decisions and evidence

2026-10-18 · CLI-T01 · development build, unpublished.

The package identity is `synapse-cli`, exposing `synapse`; registry availability has not been claimed. The executable uses strict TypeScript ES modules, Node 22 or newer, and plain text rendering without a terminal library. The package allowlist includes only `dist/cli`, README and LICENSE. Former application sources/tests/assets are retained outside that build and package to preserve existing working-tree changes. Their checks are not CLI evidence and their dependencies are removed from the active package.

The initial command contract implements `--help`, `--version`, and `--workspace <directory>` validation. Workspace roots resolve canonically, including an explicitly selected root symlink. Redirected streams refuse interactive mode. Root display is intentional sanitized output; errors are fixed strings without paths or raw exceptions. No note discovery, model request, state persistence, review, write or MCP behavior is implemented by this scaffold.

State layout selected for the future StateStore adapter: macOS `~/Library/Application Support/Synapse`; Linux `$XDG_STATE_HOME/synapse`, falling back to `~/.local/state/synapse`; Windows `%LOCALAPPDATA%/Synapse`. Each canonical workspace uses a SHA-256 identity subdirectory. Workspace ancestors/descendants and symlinked state paths must be refused before persistence. No legacy state import. State permissions and these platform paths require adapter tests when persistence is introduced; choosing a layout does not establish its implementation.

macOS and Linux with Node 22 are provisional support targets. Windows is not a claimed supported platform. No OS is release qualified until CLI-T09. Local evidence: Darwin 25.6.0 arm64, Node 22.23.3, clean dependency install, all five tests and checks passed on 2026-10-18. Local evidence is limited to the development machine; CI uses Ubuntu/Node 22. Node 23 development checks are supplemental, not the baseline.

Checks: `npm run typecheck`; `npm run lint`; `npm run boundaries`; `npm run check:network`; `npm run check:writes`; `npm run check:schema`; `npm test`; `npm run test:release`. The scaffold static checks enforce dependency boundaries and absence of network/write APIs; the schema check explicitly reports that model schemas do not exist yet. These checks must evolve as capabilities are introduced. They are not complete privacy or schema conformance gates.

The four subprocess/domain scaffold tests cover help/version, usage failures, unavailable and non-directory roots, redirected input refusal, root symlink handling and escaping terminal controls. The separate packaging test inspects the actual tarball allowlist, installs it in a temporary directory and invokes the installed executable outside the repository. Real terminal conversation and lifecycle, model quality, native MCP, recovery and release checks remain separate gates.

No release is published and no live user notes or credentials are used in these checks.

Workspace implementation work found that macOS temporary directories often arrive under a symlinked `/var` spelling. Reader adapters require the canonical workspace identity; fixture construction now uses the same root canonicalization as the CLI. A noncanonical root is refused rather than interpreted as permission to leave that identity.
