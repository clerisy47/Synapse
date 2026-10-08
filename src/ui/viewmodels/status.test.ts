import { describe, expect, it } from "vitest";
import { synapseError } from "../../core";
import type { QueueStatus } from "../../jobs";
import { ACTIONS, STATUS } from "../strings/en";
import { toMergedStatusVm, toStatusVm } from "./status";

function base(partial: Partial<QueueStatus> = {}): QueueStatus {
  return {
    model: "idle",
    queued: 0,
    ...partial,
  };
}

describe("toStatusVm", () => {
  it("maps idle", () => {
    const vm = toStatusVm(base());
    expect(vm.model).toBe("idle");
    expect(vm.barText).toBe(STATUS.idle);
    expect(vm.cssModifier).toBe("idle");
    expect(vm.showNotice).toBe(false);
    expect(vm.showRetry).toBe(false);
    expect(vm.errorIdentity).toBeNull();
    expect(vm.noticeText).toBeNull();
  });

  it("maps running with label and queued count", () => {
    const vm = toStatusVm(
      base({
        model: "running",
        queued: 2,
        running: { id: "j1", kind: "qa", label: "Q&A" },
      }),
    );
    expect(vm.model).toBe("running");
    expect(vm.barText).toBe("Vault Synapse: Q&A (2 queued)");
    expect(vm.cssModifier).toBe("running");
    expect(vm.showNotice).toBe(false);
  });

  it("maps running without queue", () => {
    const vm = toStatusVm(
      base({
        model: "running",
        running: { id: "j1", kind: "health", label: "Health" },
      }),
    );
    expect(vm.barText).toBe("Vault Synapse: Health");
  });

  it("maps paused", () => {
    const vm = toStatusVm(base({ model: "paused", queued: 1 }));
    expect(vm.model).toBe("paused");
    expect(vm.barText).toBe(STATUS.paused);
    expect(vm.showNotice).toBe(false);
  });

  it("maps error with Retry for MODEL_TIMEOUT", () => {
    const secret = "dev-only-message-must-not-leak";
    const vm = toStatusVm(
      base({
        model: "error",
        lastError: synapseError({
          code: "MODEL_TIMEOUT",
          message: secret,
          remediation: "model_timeout",
        }),
      }),
    );
    expect(vm.model).toBe("error");
    expect(vm.barText).toBe(STATUS.error);
    expect(vm.showNotice).toBe(true);
    expect(vm.showRetry).toBe(true);
    expect(vm.retryLabel).toBe(ACTIONS.retry);
    expect(vm.errorIdentity).toBe("MODEL_TIMEOUT:model_timeout");
    expect(vm.noticeText).toBeTruthy();
    expect(vm.noticeText).not.toContain(secret);
    expect(JSON.stringify(vm)).not.toContain(secret);
  });

  it("shows Retry for SCHEMA_INVALID, OUTPUT_TRUNCATED, MODEL_HTTP_ERROR", () => {
    for (const code of [
      "SCHEMA_INVALID",
      "OUTPUT_TRUNCATED",
      "MODEL_HTTP_ERROR",
    ] as const) {
      const vm = toStatusVm(
        base({
          model: "error",
          lastError: synapseError({ code, message: "dev" }),
        }),
      );
      expect(vm.showNotice).toBe(true);
      expect(vm.showRetry).toBe(true);
    }
  });

  it("shows notice without Retry for INTERNAL", () => {
    const vm = toStatusVm(
      base({
        model: "error",
        lastError: synapseError({ code: "INTERNAL", message: "stack" }),
      }),
    );
    expect(vm.showNotice).toBe(true);
    expect(vm.showRetry).toBe(false);
    expect(vm.retryLabel).toBeNull();
    expect(vm.noticeText).not.toContain("stack");
  });

  it("stays silent for CANCELLED and NOT_FOUND", () => {
    for (const code of ["CANCELLED", "NOT_FOUND"] as const) {
      const vm = toStatusVm(
        base({
          model: "error",
          lastError: synapseError({ code, message: "x" }),
        }),
      );
      expect(vm.showNotice).toBe(false);
      expect(vm.showRetry).toBe(false);
      expect(vm.noticeText).toBeNull();
      expect(vm.errorIdentity).toBeNull();
    }
  });

  it("does not notice when model is idle even if lastError is present", () => {
    const vm = toStatusVm(
      base({
        model: "idle",
        lastError: synapseError({
          code: "MODEL_TIMEOUT",
          message: "dev",
        }),
      }),
    );
    expect(vm.showNotice).toBe(false);
    expect(vm.showRetry).toBe(false);
  });
});

describe("toMergedStatusVm", () => {
  it("shows indexing while warming and queue idle", () => {
    const vm = toMergedStatusVm(base({ model: "idle" }), {
      phase: "warming",
      indexedNotes: 3,
      totalNotes: 10,
    });
    expect(vm.cssModifier).toBe("indexing");
    expect(vm.barText).toBe("Vault Synapse: indexing 3/10");
  });

  it("prefers running jobs over indexing", () => {
    const vm = toMergedStatusVm(
      base({
        model: "running",
        running: { id: "j1", kind: "health", label: "Health" },
      }),
      { phase: "warming", indexedNotes: 1, totalNotes: 5 },
    );
    expect(vm.cssModifier).toBe("running");
    expect(vm.barText).toBe("Vault Synapse: Health");
  });

  it("falls back to queue when index ready", () => {
    const vm = toMergedStatusVm(base({ model: "idle" }), {
      phase: "ready",
      indexedNotes: 5,
      totalNotes: 5,
    });
    expect(vm.barText).toBe(STATUS.idle);
    expect(vm.cssModifier).toBe("idle");
  });
});
