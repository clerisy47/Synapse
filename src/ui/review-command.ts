import type { Disposable } from "../core";
import type { CommandDef } from "./commands";
import { createReviewController, type ReviewController, type ReviewRunner } from "./review-controller";
import { REVIEW } from "./strings/en";

export function createResearchReviewCommand(deps: {
  createSession(): ReviewRunner | null;
  open(controller: ReviewController, onClose: Disposable): Disposable;
  notice(message: string): void;
}): { command: CommandDef; close: Disposable; dispose: Disposable } {
  let active: ReviewRunner | null = null;
  let controller: ReviewController | null = null;
  let close: Disposable | null = null;
  let disposed = false;
  function clear(): void {
    const previous = close;
    close = null;
    if (controller) controller.dispose();
    else active?.dispose();
    controller = null; active = null;
    previous?.();
  }
  return {
    command: { id: "review-research", name: REVIEW.command, async callback() {
      if (disposed || active) return;
      const session = deps.createSession();
      if (!session) { deps.notice(REVIEW.unavailable); return; }
      active = session;
      try {
        const prepared = await session.prepare();
        if (disposed || active !== session) return;
        if (!prepared.ok) { clear(); deps.notice(REVIEW.unavailable); return; }
        controller = createReviewController(session, prepared.value);
        close = deps.open(controller, clear);
      } catch { if (!disposed && active === session) { clear(); deps.notice(REVIEW.unavailable); } }
    } },
    close: clear,
    dispose() { disposed = true; clear(); },
  };
}
