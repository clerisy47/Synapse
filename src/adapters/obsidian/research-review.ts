import { Modal, type App } from "obsidian";
import type { Disposable } from "../../core";

/** Lifecycle only: rendering and local actions are supplied by the composition root. */
export function showResearchReview(app: App, mount: (el: HTMLElement, close: Disposable) => Disposable, onClose: Disposable): Disposable {
  class Review extends Modal {
    private unmount: Disposable | null = null;
    private closed = false;
    onOpen(): void { this.unmount = mount(this.contentEl, () => this.close()); }
    onClose(): void {
      if (this.closed) return;
      this.closed = true;
      this.unmount?.(); this.unmount = null;
      this.contentEl.replaceChildren();
      onClose();
    }
  }
  const review = new Review(app);
  review.open();
  return () => review.close();
}
