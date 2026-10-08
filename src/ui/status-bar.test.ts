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

  it("shows indexing progress when corpus is warming", () => {
    const status = createObservable<QueueStatus>({
      model: "idle",
      queued: 0,
    });
    const indexStatus = createObservable<{
      phase: "warming" | "ready";
      indexedNotes: number;
      totalNotes: number;
    }>({
      phase: "warming",
      indexedNotes: 2,
      totalNotes: 8,
    });
    const el = fakeEl();
    const dispose = mountStatusBar({ el, status, indexStatus });
    expect(el.textContent).toContain("indexing 2/8");
    expect(el.className).toContain("syn-status-bar--indexing");
    indexStatus.set({
      phase: "ready",
      indexedNotes: 8,
      totalNotes: 8,
    });
    expect(el.textContent).toContain("idle");
    dispose();
  });
});
