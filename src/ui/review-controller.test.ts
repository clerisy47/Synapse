import { expect, it, vi } from "vitest";
import { asVaultPath, createObservable, ok, type Approval, type ChangeProposal, type RoutingSettings } from "../core";
import { createReviewController, type ReviewRunner } from "./review-controller";
const routing: RoutingSettings = { version: 1, timezone: "UTC", destinations: [{ id: "topic", path: asVaultPath("Topic.md") }], daily: { id: "daily", folder: "Daily", filename: "YYYY-MM-DD.md", heading: "## Log" } };
it("suppresses late approval and disposes runner and pending job exactly once", async () => {
  const proposal = { changes: [{}], issues: [] } as unknown as ChangeProposal;
  let invalidate = () => {};
  let finish!: (value: ReturnType<typeof ok<Approval>>) => void;
  const cancel = vi.fn(); const dispose = vi.fn(); const unsubscribe = vi.fn();
  const runner: ReviewRunner = {
    prepare: async () => ok(routing), generate: () => ({ id: "job", result: Promise.resolve(ok({ proposal })), cancel, state: createObservable("done" as const) }),
    approve: () => new Promise((resolve) => { finish = resolve; }),
    onInvalidate: (callback) => { invalidate = callback; return unsubscribe; }, dispose,
  };
  const controller = createReviewController(runner, routing); controller.choices(["topic"], ""); await controller.generate(); controller.decide(0, "accept");
  const pending = controller.approve(); invalidate(); finish(ok({} as Approval)); await pending;
  expect(controller.state.get().phase).toBe("stale");
  controller.dispose(); controller.dispose();
  expect(dispose).toHaveBeenCalledTimes(1); expect(unsubscribe).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
});
