import { NodeHttpTransport } from "../../src/adapters/node";
import { TransportError } from "../../src/core";
// @vitest-environment happy-dom
import { get } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { TFile, type App, type PluginManifest } from "obsidian";
import type { McpServerPort } from "../../src/core";
import { CONTROL_STARTERS } from "../../src/instructions";
import VaultSynapsePlugin from "../../src/main";
import { VIEW_TYPE_CHAT } from "../../src/constants";

const host = vi.hoisted(() => ({
  commands: new Map<string, { callback(): void }>(),
  views: new Map<string, (leaf: unknown) => { onOpen(): Promise<void>; onClose(): Promise<void> }>(),
  ribbonClick: () => {}, ribbonRemoved: false,
}));
vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  Plugin: class {
    constructor(public app: App, public manifest: PluginManifest) {}
    async loadData() { return null; }
    async saveData() {}
    addCommand(command: { id: string; callback(): void }) { host.commands.set(command.id, command); }
    addSettingTab() {}
    addStatusBarItem() { return document.createElement("div"); }
    registerView(type: string, factory: (leaf: unknown) => { onOpen(): Promise<void>; onClose(): Promise<void> }) { host.views.set(type, factory); }
    addRibbonIcon(_icon: string, _title: string, callback: () => void) {
      host.ribbonClick = callback;
      return { remove: () => { host.ribbonRemoved = true; } };
    }
  },
}));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); host.commands.clear(); host.views.clear(); });

it.each(["ready", "missing", "invalid"] as const)("loads without a key, opens chat, respects %s policy and unloads cleanly", async (policyState) => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.spyOn(NodeHttpTransport.prototype, "getJson").mockRejectedValue(new TransportError({ kind: "refused", message: "offline" }));
  vi.spyOn(NodeHttpTransport.prototype, "postStream").mockImplementation(async function* () {
    throw new TransportError({ kind: "refused", message: "offline" });
  });
  const consoleError = vi.spyOn(console, "error");
  const contentEl = document.createElement("div");
  let view: { onOpen(): Promise<void>; onClose(): Promise<void> } | undefined;
  let opened = false;
  const leaf = {
    contentEl,
    async setViewState({ type }: { type: string }) {
      view = host.views.get(type)?.(leaf);
      await view?.onOpen(); opened = true;
    },
  };
  const revealLeaf = vi.fn(async () => {});
  const offref = vi.fn();
  const policyFile = Object.assign(new TFile(), { path: "Synapse/Security.md", extension: "md" });
  const files = policyState === "missing" ? [] : [policyFile];
  const pluginFiles = new Map<string, string>();
  const app = {
    vault: { adapter: {
      exists: async (path: string) => pluginFiles.has(path),
      read: async (path: string) => pluginFiles.get(path) ?? "",
      write: async (path: string, text: string) => { pluginFiles.set(path, text); },
      mkdir: async () => {},
    }, getFiles: () => files, getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      read: async () => policyState === "ready" ? CONTROL_STARTERS.security : "malformed rules",
      on: () => ({}), offref },
    metadataCache: { getCache: () => null, resolvedLinks: {}, on: () => ({}), offref },
    workspace: {
      on: () => ({}), offref, onLayoutReady: (callback: () => void) => callback(),
      getLeavesOfType: (type: string) => type === VIEW_TYPE_CHAT && opened ? [leaf] : [],
      getRightLeaf: () => leaf, revealLeaf,
      detachLeavesOfType: () => { void view?.onClose(); opened = false; },
    },
  } as unknown as App;
  const plugin = new VaultSynapsePlugin(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload();
  expect(consoleError).not.toHaveBeenCalled();
  host.commands.get("open-chat")?.callback();
  await vi.waitFor(() => expect(contentEl.querySelector("textarea")).not.toBeNull());
  host.ribbonClick();
  await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalled());
  const question = contentEl.querySelector("textarea")!;
  question.value = "What is in my vault?";
  contentEl.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(contentEl.querySelector(".syn-chat-answer")?.textContent).toBe(policyState === "ready" ? "Start Prism llama-server on 127.0.0.1:18080 with Bonsai 2 4B, then run the health check. See docs/bonsai.md." : "Access is unavailable or changed. Check Security.md and retry."));
  const mcp = (plugin as unknown as { mcp: McpServerPort }).mcp;
  expect(mcp.status()).toMatchObject({ enabled: false, failed: false, url: null });
  await mcp.pair("host synthetic", []);
  await mcp.enable(); let endpoint = mcp.status().url!;
  const request = () => new Promise<number | undefined>((resolve, reject) => {
    const req = get(endpoint, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
  });
  try {
    expect(await request()).toBe(401);
    (plugin as unknown as { applySettingsPatch(p: { logLevel: string }): void }).applySettingsPatch({ logLevel: "warn" });
    expect(mcp.status()).toMatchObject({ enabled: false, url: null });
    await expect(request()).rejects.toThrow();
    await mcp.enable(); endpoint = mcp.status().url!;
  } finally { plugin.onunload(); }
  expect(mcp.status().url).toBeNull();
  await expect(request()).rejects.toThrow();
  expect(contentEl.childElementCount).toBe(0);
  expect(host.ribbonRemoved).toBe(true);
  expect(offref).toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});
