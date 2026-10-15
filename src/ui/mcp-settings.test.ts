// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { McpServerPort } from "../core";
import { mountMcpSettings } from "./mcp-settings";

it("requires explicit local scopes, shows a bearer once and clears it on disposal", async () => {
  const root = document.createElement("div");
  const pair = vi.fn(async () => ({ id: "client", token: "synthetic-bearer" }));
  const revoke = vi.fn(async () => {});
  const mcp: McpServerPort = {
    status: () => ({ enabled: false, failed: false, url: null, clients: [{ id: "client", label: "<img onerror=bad>", scopes: [], generation: 0 }] }),
    pair, revoke, enable: async () => {}, disable: async () => {}, invalidate() {}, dispose() {},
  };
  const dispose = mountMcpSettings(root, mcp);
  const button = (prefix: string) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.startsWith(prefix))!;
  expect(Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).every((i) => !i.checked)).toBe(true);
  expect(root.querySelector("img")).toBeNull();
  const label = root.querySelector<HTMLInputElement>("label input")!; label.value = "Local client"; label.dispatchEvent(new Event("input"));
  button("Confirm scopes").click(); await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe("synthetic-bearer"));
  expect(pair).toHaveBeenCalledWith("Local client", []);
  button("Hide bearer").click(); expect(root.querySelector('input[readonly]')).toBeNull();
  button("Revoke").click(); await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("client"));
  dispose(); expect(root.childElementCount).toBe(0);
});

it("does not expose a late pairing credential after settings close", async () => {
  const root = document.createElement("div"); let resolve!: (v: { id: string; token: string }) => void;
  const mcp: McpServerPort = {
    status: () => ({ enabled: false, failed: false, url: null, clients: [] }),
    pair: () => new Promise((r) => { resolve = r; }), revoke: async () => {}, enable: async () => {}, disable: async () => {}, invalidate() {}, dispose() {},
  };
  const close = mountMcpSettings(root, mcp);
  Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Confirm scopes"))!.click();
  close(); resolve({ id: "synthetic", token: "never-display" }); await Promise.resolve(); await Promise.resolve();
  expect(root.textContent).toBe(""); expect(root.childElementCount).toBe(0);
});
