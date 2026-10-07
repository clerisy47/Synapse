import { describe, expect, it, vi } from "vitest";
import { createObservable, synapseError } from "../core";
import type { QueueStatus } from "../jobs";
import { mountStatusNotices, type NoticePresentation } from "./notices";
import { ACTIONS } from "./strings/en";

describe("mountStatusNotices", () => {
  it("presents once per error identity and attaches Retry", () => {
    const present = vi.fn<(p: NoticePresentation) => void>();
    const onRetry = vi.fn();
    const status = createObservable<QueueStatus>({
      model: "idle",
      queued: 0,
    });

    const dispose = mountStatusNotices({ status, present, onRetry });
    expect(present).not.toHaveBeenCalled();

    const errStatus: QueueStatus = {
      model: "error",
      queued: 0,
      lastError: synapseError({
        code: "MODEL_TIMEOUT",
        message: "dev-secret",
        remediation: "model_timeout",
      }),
    };
    status.set(errStatus);
    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: ACTIONS.retry,
        onAction: onRetry,
      }),
    );
    const firstMessage = present.mock.calls[0]?.[0]?.message ?? "";
    expect(firstMessage).not.toContain("dev-secret");
    expect(firstMessage.length).toBeGreaterThan(0);

    status.set({ ...errStatus });
    expect(present).toHaveBeenCalledTimes(1);

    status.set({ model: "idle", queued: 0 });
    status.set(errStatus);
    expect(present).toHaveBeenCalledTimes(2);

    dispose();
  });

  it("does not present for CANCELLED", () => {
    const present = vi.fn();
    const status = createObservable<QueueStatus>({
      model: "error",
      queued: 0,
      lastError: synapseError({ code: "CANCELLED", message: "x" }),
    });
    mountStatusNotices({ status, present });
    expect(present).not.toHaveBeenCalled();
  });
});
