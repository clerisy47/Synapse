import type { Disposable, Result } from "../core";
import type { CommandDef } from "./commands";
import { createReviewController, type ReviewRunner } from "./review-controller";
import { mountReviewView } from "./views/review-view";
import { RECOVERY } from "./strings/en";

/** No persisted paths or bodies are shown until the feature rechecks current policy. */
export function createRecoveryCommand(deps: {
  records(): Promise<Result<readonly { id: string; outcomes: readonly string[] }[]>>;
  session(id: string): ReviewRunner | null;
  open(mount: (el: HTMLElement, close: () => void) => Disposable, onClose: Disposable): Disposable;
  notice(message: string): void;
}): { command: CommandDef; initialize(): Promise<void>; close: Disposable; dispose: Disposable } {
  let disposed = false;
  let active = false;
  let epoch = 0;
  let closing: Disposable | null = null;
  let session: ReviewRunner | null = null;
  const clear = () => { ++epoch; const previous = closing; closing = null; session?.dispose(); session = null; active = false; previous?.(); };
  return {
    async initialize() {
      const result = await deps.records();
      if (disposed) return;
      if (!result.ok) deps.notice(RECOVERY.unavailable);
      else if (result.value.some((r) => r.outcomes.some((s) => !["applied", "refused"].includes(s)))) deps.notice(RECOVERY.pending);
    },
    command: { id: "review-recovery", name: RECOVERY.command, async callback() {
      if (disposed || active) return;
      active = true;
      const generation = ++epoch;
      try {
        const records = await deps.records();
        if (disposed || generation !== epoch) return;
        if (!records.ok) { clear(); deps.notice(RECOVERY.unavailable); return; }
        closing = deps.open((el, close) => {
          const doc = el.ownerDocument;
          const title = doc.createElement("h2"); title.textContent = RECOVERY.command; el.append(title);
          const disclosure = doc.createElement("p"); disclosure.textContent = RECOVERY.disclosure; el.append(disclosure);
          if (!records.value.length) { const empty = doc.createElement("p"); empty.textContent = RECOVERY.empty; el.append(empty); }
          for (const record of [...records.value].reverse()) {
            const row = doc.createElement("p"); row.textContent = RECOVERY.record(record.id, record.outcomes); el.append(row);
            const button = doc.createElement("button"); button.textContent = RECOVERY.revert; el.append(button);
            button.disabled = !record.outcomes.includes("applied");
            button.addEventListener("click", () => {
              if (disposed || generation !== epoch || session) return;
              const runner = deps.session(record.id); if (!runner) return;
              session = runner; button.disabled = true;
              void runner.prepare().then((prepared) => {
                if (disposed || generation !== epoch) return;
                if (!prepared.ok) { runner.dispose(); session = null; deps.notice(RECOVERY.unavailable); return; }
                const controller = createReviewController(runner, prepared.value);
                cleanupReview = mountReviewView(el, controller, close);
                cleanupController = () => controller.dispose();
              }).catch(() => { if (!disposed && generation === epoch) { runner.dispose(); session = null; deps.notice(RECOVERY.unavailable); } });
            });
          }
          const cancel = doc.createElement("button"); cancel.textContent = RECOVERY.close; cancel.addEventListener("click", close); el.append(cancel);
          let cleanupReview: Disposable | null = null;
          let cleanupController: Disposable | null = null;
          return () => { cleanupReview?.(); cleanupController?.(); el.replaceChildren(); };
        }, clear);
      } catch { if (!disposed && generation === epoch) { clear(); deps.notice(RECOVERY.unavailable); } }
    } },
    close: clear,
    dispose() { disposed = true; clear(); },
  };
}
