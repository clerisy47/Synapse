# R3-T04 real Obsidian apply smoke

> Historical evidence: Security.md support was removed on 2026-10-17. Use [current access contracts](control-contracts.md) for active requirements.

The revised PLAN defers this real Obsidian apply check to R5-T03/R5-T04.
R3-T04 uses headless validation; injected-host and mini-vault tests do not
replace this final host check.

Use a disposable synthetic vault and the file/settings fixture from
[r3-t03-review-smoke.md](r3-t03-review-smoke.md). Install the freshly built
`main.js`, `manifest.json`, and `styles.css` into its plugin folder, reload the
plugin, and create the `Daily` folder manually. Keep `openrouter/free` and your
locally configured key. Do not include credentials or note bodies in results.

1. Save the fixture files. Select Research.md's sentence; run **Review research**.
   Choose Topic and daily, enter `2026-10-15`, generate, and inspect complete text.
   Accept Topic, reject daily, approve. Verify neither note has changed yet.
   Click **Apply approved changes** once. Verify Topic exactly matches reviewed
   text, Research is unchanged, daily was not created, and the result says Applied.
   There must be no second Apply button or automatic retry.
2. Add a different synthetic sentence to Research.md (a fresh batch), select it,
   and review/approve a daily creation for a new explicit date. Apply and check
   the daily content matches the full reviewed proposal and Research is preserved.
3. With fresh batches, edit a destination or Security.md after approval. Verify
   application becomes stale/refused without overwriting the edit. Test an unsaved
   destination in another pane, including a background pane.
4. With another fresh batch, close/Escape before Apply: no note changes. Close or
   disable during application: no subsequent writes; a write already committed
   remains. Re-enable and confirm review and chat commands open normally.
5. Check keyboard navigation and readable per-file results at narrow widths.

Application is sequential, not atomic. Refused/unknown outcomes stop remaining
writes. An attempted batch is conservatively blocked from generation again;
per-file restart reconciliation and reviewed revert are R3-T05. If a storage
operation reports an unknown outcome, inspect the note rather than retrying.

Report pass/fail by step and numeric Obsidian version. If OpenRouter fails,
report the failure and leave the live apply check pending; do not change models.
