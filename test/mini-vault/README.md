# Synthetic mini Obsidian vault

Run `npm run test:vault` from the project root. No Obsidian app, UI automation,
API key or live provider is needed. All note content here is synthetic.

`mini-vault.test.ts` copies this directory into `test/.mini-vault-run-*`, exercises
production restricted writer and inbox append interfaces against real files, and
removes the copy afterward. The committed fixtures are preserved. The `.obsidian`
folder makes this a minimal vault; no plugin or credentials are installed.

The command also runs existing headless integration coverage for Q&A using a
mock OpenRouter server, control loading, recipient policy/tools and research
capture. Those existing suites use their own in-memory fixtures. Disk-backed
writer calls supply an already authorized test gate; end-to-end local approval
binding remains covered by the separate research-review integration suite.

This is a test host, not an implementation of Obsidian's cache, locking or editor
lifecycle. MCP HTTP endpoints are not implemented yet; add their authenticated
client tests here when R4 lands. Live model tests must use `openrouter/free`.
Actual Obsidian load, UI, apply and client smoke remain final release checks in
PLAN R5-T03/R5-T04. Existing `docs/r3-t03-review-smoke.md` and
`docs/r3-t04-apply-smoke.md` are deferred operator checklists.
