// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";
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

it("loads without a key, opens chat by command/ribbon, reports model failure, and unloads cleanly", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
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
  const app = {
    vault: { adapter: {}, getFiles: () => [], getMarkdownFiles: () => [], on: () => ({}), offref },
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
  await vi.waitFor(() => expect(contentEl.querySelector(".syn-chat-answer")?.textContent).toBe("The model request failed. You can retry."));
  plugin.onunload();
  expect(contentEl.childElementCount).toBe(0);
  expect(host.ribbonRemoved).toBe(true);
  expect(offref).toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});
