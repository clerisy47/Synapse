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

/** Small workspace surface for testing reveal/reuse without the Obsidian runtime. */
export type ChatWorkspace = {
  getLeavesOfType(type: string): WorkspaceLeaf[];
  getRightLeaf(split: boolean): WorkspaceLeaf | null;
  revealLeaf(leaf: WorkspaceLeaf): Promise<void>;
};

/** Coalesce concurrent command/ribbon clicks to avoid duplicate sidebar leaves. */
export function createChatOpener(workspace: ChatWorkspace, viewType: string): () => Promise<void> {
  let opening: Promise<void> | null = null;
  return () => {
    if (opening) return opening;
    opening = (async () => {
      let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(viewType)[0];
      if (!leaf) {
        leaf = workspace.getRightLeaf(false) ?? undefined;
        if (!leaf) throw new Error("Chat sidebar unavailable");
        await leaf.setViewState({ type: viewType, active: true });
      }
      await workspace.revealLeaf(leaf);
    })().finally(() => { opening = null; });
    return opening;
  };
}
