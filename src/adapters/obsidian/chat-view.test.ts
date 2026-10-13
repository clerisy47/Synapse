import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { createChatOpener, createChatItemViewFactory } from "./chat-view";

describe("chat ItemView", () => {
  it("mounts on open and disposes on reopen/close", async () => {
    const el = {} as HTMLElement;
    const dispose = vi.fn();
    const mount = vi.fn(() => dispose);
    const view = createChatItemViewFactory({ viewType: "test-chat", displayText: "Chat", mount })({ contentEl: el } as unknown as WorkspaceLeaf);
    expect(view.getViewType()).toBe("test-chat");
    expect(view.getDisplayText()).toBe("Chat");
    await view.onOpen();
    expect(mount).toHaveBeenCalledWith(el);
    await view.onOpen();
    expect(dispose).toHaveBeenCalledTimes(1);
    await view.onClose(); await view.onClose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});

describe("chat sidebar opener", () => {
  it("creates a right sidebar leaf once for simultaneous clicks, then reuses it", async () => {
    let leaves: WorkspaceLeaf[] = [];
    const setViewState = vi.fn(async () => { await Promise.resolve(); leaves = [leaf]; });
    const leaf = { setViewState } as unknown as WorkspaceLeaf;
    const workspace = {
      getLeavesOfType: vi.fn(() => leaves),
      getRightLeaf: vi.fn(() => leaf),
      revealLeaf: vi.fn(async () => {}),
    };
    const open = createChatOpener(workspace, "test-chat");
    await Promise.all([open(), open()]);
    expect(setViewState).toHaveBeenCalledExactlyOnceWith({ type: "test-chat", active: true });
    expect(workspace.getRightLeaf).toHaveBeenCalledExactlyOnceWith(false);
    await open();
    expect(setViewState).toHaveBeenCalledTimes(1);
    expect(workspace.revealLeaf).toHaveBeenCalledTimes(2);
  });

  it("allows retry after a failed reveal", async () => {
    const leaf = {} as WorkspaceLeaf;
    const revealLeaf = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(undefined);
    const open = createChatOpener({ getLeavesOfType: () => [leaf], getRightLeaf: () => null, revealLeaf }, "test-chat");
    await expect(open()).rejects.toThrow("Unavailable");
    await expect(open()).resolves.toBeUndefined();
    expect(revealLeaf).toHaveBeenCalledTimes(2);
  });
});
