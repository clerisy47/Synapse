// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { asVaultPath } from "../core";
import { mountMetadataView } from "./metadata-view";
it("explains exclusion from retrieval, lists field guidance and never renders metadata as HTML", () => {
  const el = document.createElement("div"); const create = vi.fn(() => null);
  const dispose = mountMetadataView(el, { repairs: () => [{ path: asVaultPath("<img src=x>.md"), issues: [{ field: "description", reason: "missing" }] }, { path: asVaultPath("Malformed.md"), issues: [{ field: "frontmatter", reason: "invalid" }] }], create, close: vi.fn() });
  expect(el.textContent).toContain("2 notes need metadata attention");
  expect(el.textContent).toContain("excluded from normal search, chat and MCP retrieval until repaired");
  expect(el.textContent).toContain("aliases (0–12");
  expect(el.querySelector("img")).toBeNull();
  expect(Array.from(el.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent === "Propose missing fields")).toHaveLength(1);
  expect(create).not.toHaveBeenCalled(); dispose(); expect(el.childElementCount).toBe(0);
});
