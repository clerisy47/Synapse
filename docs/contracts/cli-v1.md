# Native CLI result contract v1

2026-10-19. `synapse ask --workspace <directory> <question> --json` returns one UTF-8 JSON object followed by a newline on stdout. Progress and fixed diagnostics use stderr. It never reads approval from stdin. Questions are explicit command arguments; workspace selection is mandatory.

Successful result: `version: 1`, `status: "answered" | "insufficient_evidence"`, `answer: string | null`, and `sources: []`. Each source has a one-based local `id`, workspace-relative `path`, one-based inclusive `start_line`/`end_line`, and application-owned `text`. Answers currently consist of selected verified body passages; generated prose is not presented as verified fact. Insufficient evidence has `answer: null` and no sources. Metadata aids discovery but is not factual source text.

Failure result: `version: 1`, `status: "error"`, `error: {code: <fixed public code>}`. No raw provider/OS errors, arguments, paths, prompts or credentials appear in diagnostic/error fields. Source coordinates and intentional local source display are separate from diagnostics. JSON escapes terminal controls/direction formatting without changing parsed machine data.

Exit codes are 0 for a completed result including insufficient evidence, 1 for runtime/budget/provider failure, 2 for usage/root/TTY configuration failure, 3 for access/consent refusal or conflict, and 130 for cancellation. Broken output streams cannot guarantee a complete JSON document; errors still never disclose source content through stderr.

Interactive mode requires both stdin and stdout to be TTYs. `/source N` rechecks the latest successful answer's source, `/reset` discards in-memory conversation state, `/quit` and EOF exit, and SIGINT cancels. Source errors refuse rather than displaying stale content. Source and command errors report fixed codes and preserve the interactive session; cancellation exits. One-shot failures use the exit codes above. No generic command execution exists.

The local default is Bonsai. An explicit remote selection uses `--provider openrouter --model <author/model> --remote-consent`; help contains the disclosure accepted by that flag. This consent does not grant write approval or MCP scopes. No fallback is performed. `doctor --workspace <directory> --offline` validates only local root/state overlap without network requests.
