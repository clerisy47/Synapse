import { expect, it, vi } from "vitest";
import { err, ok, synapseError, type Disposable, type Result, type RoutingSettings } from "../core";
import { createResearchReviewCommand } from "./review-command";
import type { ReviewController, ReviewRunner } from "./review-controller";
function runner() {
  const prepare = vi.fn(async () => ok({} as RoutingSettings));
  const dispose = vi.fn();
  const session: ReviewRunner = { prepare, generate: vi.fn(() => null), approve: vi.fn(async () => err(synapseError({ code: "INTERNAL", message: "Unavailable" }))), onInvalidate: () => () => {}, dispose };
  return { session, prepare, dispose };
}
it("captures before opening, coalesces commands, and disposes on close and unload", async () => {
  const { session, prepare } = runner(); const close = vi.fn(); let onClose = () => {};
  const open = vi.fn((_controller: ReviewController, callback: Disposable) => { onClose = callback; return close; });
  const createSession = vi.fn(() => session);
  const workflow = createResearchReviewCommand({ createSession, open, notice: vi.fn() });
  await Promise.all([workflow.command.callback(), workflow.command.callback()]);
  expect(createSession).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
  expect(prepare).toHaveBeenCalledBefore(open);
  onClose(); expect(close).toHaveBeenCalledTimes(1);
  workflow.dispose(); expect(close).toHaveBeenCalledTimes(1);
});
it("unload during capture closes nothing and ignores late results", async () => {
  const { session, dispose } = runner(); let resolve!: (value: Result<RoutingSettings>) => void;
  session.prepare = () => new Promise((done) => { resolve = done; });
  const open = vi.fn(); const notice = vi.fn();
  const workflow = createResearchReviewCommand({ createSession: () => session, open, notice });
  const pending = workflow.command.callback(); workflow.dispose(); resolve(ok({} as RoutingSettings)); await pending;
  expect(open).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalled();
});
it("uses fixed notices for failed capture and thrown private errors", async () => {
  const { session } = runner(); const notice = vi.fn(); const open = vi.fn();
  session.prepare = async () => { throw Error("secret vault content"); };
  const workflow = createResearchReviewCommand({ createSession: () => session, open, notice });
  await workflow.command.callback(); expect(notice).toHaveBeenCalledTimes(1); expect(JSON.stringify(notice.mock.calls)).not.toContain("secret"); expect(open).not.toHaveBeenCalled();
});
