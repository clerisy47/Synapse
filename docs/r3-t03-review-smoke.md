# R3-T03 real Obsidian review smoke

> Historical evidence: Security.md support was removed on 2026-10-17. Use [current access contracts](control-contracts.md) for active requirements.

This is the remaining real-host acceptance check from PLAN R3-T03. Automated
DOM and injected-host tests are separate evidence. This milestone approves only
in memory and has no note writer; closing review discards approval.

Use a disposable synthetic vault. Copy the built `main.js`, `manifest.json`,
and `styles.css` into `.obsidian/plugins/vault-synapse/`, enable the plugin, and
keep the default OpenRouter model `openrouter/free`. Use your locally configured
API key; never include it in evidence. Do not use personal note content.

Create these files manually. Synapse does not write them.

`Synapse/Instructions.md`:

```markdown
---
{"version":1,"timezone":"Asia/Kathmandu","destinations":[{"id":"topic","path":"Notes/Topic.md"}],"daily":{"id":"daily-log","folder":"Daily","filename":"YYYY-MM-DD.md","heading":"## Log"}}
---
Use concise Markdown bullets. Preserve existing unrelated content.
```

`Synapse/Security.md` (synthetic-vault-only grants):

```markdown
---
{"version":1,"defaults":{"internal":"allow","remote-model":"allow","external-client":"deny"},"rules":[{"id":"create-synthetic","recipient":"internal","operation":"create","effect":"allow","selector":{}},{"id":"update-synthetic","recipient":"internal","operation":"update","effect":"allow","selector":{}}]}
---
Synthetic review smoke only.
```

`Notes/Topic.md`:

```markdown
# Topic
Preserve this original paragraph.
```

`Research.md`:

```markdown
Synthetic observation: the prototype completed two test runs on 2026-10-15.
```

1. Save all files. Select the complete sentence in Research.md, then run
   **Synapse: Review research**. Verify both configured destinations and the
   timezone are visible. Repeating the command must not open another review.
2. Select Topic and daily note, enter `2026-10-15`, and generate. A missing date
   must prevent submission when daily note is selected. Wait for the queued job.
   Provider errors must display a fixed failure message; do not switch models.
3. Verify each full destination, create/update operation, source provenance,
   evidence IDs and complete original/proposed Markdown. Check narrow-window
   scrolling, text selection, Tab navigation and accept/reject controls.
4. Accept one change and reject the other. Approval stays disabled until every
   change has a decision. Approve and verify the explicit **No notes were saved**
   message. The original Topic and Research files must be unchanged; no daily
   note may have been created.
5. Repeat a fresh review; edit/save Research, Topic, Instructions or Security
   during generation/review. Verify the review becomes stale, approval is
   disabled, and a new command/capture is required. Unsaved target edits must
   also prevent approval.
6. Close/Escape or cancel generation. Verify no writes, no late proposal/modal
   reappearance, and a new command works. Reload/disable the plugin during a
   pending review; verify the modal closes and no late result appears. Confirm
   existing chat still opens after re-enabling the plugin.

Report pass/fail for these steps and the Obsidian version, without keys, note
bodies or screenshots containing personal data.

Operator result (2026-10-15): the user reported **Pass**, using the “latest”
Obsidian version; no numeric version was supplied.
