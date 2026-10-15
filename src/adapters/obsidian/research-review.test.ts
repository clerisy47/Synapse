// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { App } from "obsidian";
const host = vi.hoisted(() => ({ modal: null as { onClose(): void; contentEl: HTMLElement } | null }));
vi.mock("obsidian", () => ({ Modal: class {
  contentEl = document.createElement("div");
  constructor() { host.modal = this as unknown as typeof host.modal; }
  open() { (this as unknown as { onOpen(): void }).onOpen(); }
  close() { (this as unknown as { onClose(): void }).onClose(); }
} }));
import { showResearchReview } from "./research-review";
it("unmounts and notifies once across escape, repeated close and plugin unload", () => {
  const unmount = vi.fn(); const onClose = vi.fn(); const mount = vi.fn(() => unmount);
  const close = showResearchReview({} as App, mount, onClose);
  expect(mount).toHaveBeenCalledOnce();
  host.modal!.onClose(); close(); close();
  expect(unmount).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce(); expect(host.modal!.contentEl.childNodes).toHaveLength(0);
});
