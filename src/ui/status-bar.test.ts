import { describe, expect, it } from "vitest";
import { createObservable } from "../core";
import type { QueueStatus } from "../jobs";
import { mountStatusBar } from "./status-bar";

function fakeEl(): HTMLElement {
  return { className: "", textContent: "" } as HTMLElement;
}

describe("mountStatusBar", () => {
  it("applies initial idle state and updates on publish", () => {
    const status = createObservable<QueueStatus>({
      model: "idle",
      queued: 0,
    });
    const el = fakeEl();
    const dispose = mountStatusBar({ el, status });

    expect(el.textContent).toContain("idle");
    expect(el.className).toContain("syn-status-bar--idle");

    status.set({
      model: "running",
      queued: 0,
      running: { id: "1", kind: "qa", label: "Q&A" },
    });
    expect(el.textContent).toContain("Q&A");
    expect(el.className).toContain("syn-status-bar--running");

    dispose();
    expect(el.textContent).toBe("");
    expect(el.className).toBe("");
  });
});
