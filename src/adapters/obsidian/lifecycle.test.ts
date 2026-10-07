/**
 * Lifecycle helper unit tests (M1-T13).
 */

import { describe, expect, it, vi } from "vitest";

import { bindExternalSettingsChange, onLayoutReady } from "./lifecycle";

describe("bindExternalSettingsChange", () => {
  it("assigns onExternalSettingsChange to call notify", () => {
    const notify = vi.fn();
    const plugin = {} as {
      onExternalSettingsChange?: () => void;
    };
    bindExternalSettingsChange(
      plugin as import("obsidian").Plugin,
      notify,
    );
    expect(typeof plugin.onExternalSettingsChange).toBe("function");
    plugin.onExternalSettingsChange?.();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("onLayoutReady", () => {
  it("invokes callback via workspace.onLayoutReady", () => {
    const cb = vi.fn();
    let registered: (() => void) | undefined;
    const app = {
      workspace: {
        onLayoutReady(fn: () => void) {
          registered = fn;
        },
      },
    };
    const dispose = onLayoutReady(app as import("obsidian").App, cb);
    expect(registered).toBeTypeOf("function");
    registered?.();
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
    registered?.();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
