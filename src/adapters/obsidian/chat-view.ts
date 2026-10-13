/** ItemView lifecycle adapter; UI mounting is injected by the composition root. */
import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Disposable } from "../../core";

export type CreateChatItemViewOptions = {
  viewType: string;
  displayText: string;
  mount(el: HTMLElement): Disposable;
};

export type ChatItemView = ItemView & { onOpen(): Promise<void>; onClose(): Promise<void> };

export function createChatItemViewFactory(opts: CreateChatItemViewOptions): (leaf: WorkspaceLeaf) => ChatItemView {
  return (leaf) => new class extends ItemView {
    private disposePane: Disposable | null = null;
    getViewType(): string { return opts.viewType; }
    getDisplayText(): string { return opts.displayText; }
    getIcon(): string { return "messages-square"; }
    async onOpen(): Promise<void> {
      this.disposePane?.();
      this.disposePane = null;
      this.disposePane = opts.mount(this.contentEl);
    }
    async onClose(): Promise<void> {
      this.disposePane?.();
      this.disposePane = null;
    }
  }(leaf);
}
