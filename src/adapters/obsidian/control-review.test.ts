// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
const host = vi.hoisted(() => ({ content: null as HTMLElement | null }));
vi.mock("obsidian", () => ({ Modal: class {
  contentEl = document.createElement("div");
  constructor() {
    host.content = this.contentEl;
    Object.assign(this.contentEl, {
      createEl: (tag: string, options: { text: string; cls?: string }) => {
        const element = document.createElement(tag);
        element.textContent = options.text;
        element.className = options.cls ?? "";
        this.contentEl.append(element);
        return element;
      },
      empty: () => this.contentEl.replaceChildren(),
    });
  }
  open() { (this as unknown as { onOpen(): void }).onOpen(); }
} }));
import { showControlReview } from "./control-review";
import type { App } from "obsidian";

it("shows exact inert starter text without granting an apply capability", () => {
  const text = "---\r\nversion: 1\r\n---\r\n<script>alert('input')</script>";
  showControlReview({} as App, "Review", "Review only", [{ path: "Config/Rules.md", after: text }]);
  expect(host.content?.querySelector("pre")?.textContent).toBe(text);
  expect(host.content?.querySelector("script")).toBeNull();
  expect(host.content?.querySelector("button")).toBeNull();
  expect(host.content?.querySelector("h3")?.textContent).toBe("Config/Rules.md");
});
