import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { createChatItemViewFactory } from "./chat-view";

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
