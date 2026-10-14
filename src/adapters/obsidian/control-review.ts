import { Modal, type App } from "obsidian";

/** Inert exact-content review, with no write or approval capability. */
export function showControlReview(app: App, title: string, message: string, changes: readonly { path: string; after: string }[]): void {
  class Review extends Modal {
    onOpen(): void {
      this.contentEl.createEl("h2", { text: title });
      this.contentEl.createEl("p", { text: message });
      for (const change of changes) {
        this.contentEl.createEl("h3", { text: change.path });
        this.contentEl.createEl("pre", { text: change.after, cls: "syn-control-starter" });
      }
    }
    onClose(): void { this.contentEl.empty(); }
  }
  new Review(app).open();
}
