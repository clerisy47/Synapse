// @vitest-environment happy-dom
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { TFile, type App, type PluginManifest } from "obsidian";
import VaultSynapsePlugin from "../../src/main";
import { defaultPersistedState, parsePersisted } from "../../src/state";
import { RESEARCH } from "../../src/ui";

const host = vi.hoisted(() => ({ commands: new Map<string, { callback(): void | Promise<void> }>(), notices: [] as string[], data: null as unknown, saves: 0 }));
vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<typeof import("obsidian")>();
  return { ...original,
    Notice: class extends original.Notice {
      constructor(message: string, timeout?: number) { super(message, timeout); host.notices.push(message); }
    },
    Plugin: class {
      constructor(public app: App, public manifest: PluginManifest) {}
      async loadData() { return structuredClone(host.data); }
      async saveData(data: unknown) { host.data = structuredClone(data); ++host.saves; }
      addCommand(command: { id: string; callback(): void | Promise<void> }) { host.commands.set(command.id, command); }
      addSettingTab() {}
      addStatusBarItem() { return document.createElement("div"); }
      registerView() {}
      addRibbonIcon() { return { remove() {} }; }
    },
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); host.commands.clear(); host.notices.length = 0; host.data = null; host.saves = 0; });

function pluginClass(): typeof VaultSynapsePlugin {
  if (process.env.SYNAPSE_SMOKE_BUNDLE !== "1") return VaultSynapsePlugin;
  const localRequire = createRequire(import.meta.url);
  const module = { exports: {} as { default: typeof VaultSynapsePlugin } };
  runInNewContext(readFileSync("main.js", "utf8"), {
    module, exports: module.exports, require: (name: string) => name === "obsidian" ? obsidian : localRequire(name),
    window, document, crypto, structuredClone, TextEncoder, TextDecoder, AbortController, performance, console, process,
    setTimeout, clearTimeout,
  });
  return module.exports.default;
}

it("captures selection through the host command, preserves inbox, restarts and unloads listeners", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const consoleError = vi.spyOn(console, "error");
  const text = "synthetic research with untrusted instructions";
  const file = Object.assign(new TFile(), { path: "Inbox/Rough.md", extension: "md" });
  const saved = defaultPersistedState(); saved.settings.controlPaths = { ...saved.settings.controlPaths, research: file.path as typeof saved.settings.controlPaths.research }; host.data = saved;
  const listeners = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
  const on = (name: string, callback: (...args: unknown[]) => void) => { const ref = {}; listeners.set(ref, { name, callback }); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  let editorText = text;
  let selection = { start: 0, end: text.length };
  const editor = { getValue: () => editorText, getCursor: (which: string) => ({ line: 0, ch: which === "from" ? selection.start : selection.end }), posToOffset: ({ ch }: { ch: number }) => ch };
  const modify = vi.fn(); const create = vi.fn(); const read = vi.fn(async () => text);
  const app = {
    vault: { adapter: {}, getFiles: () => [file], getMarkdownFiles: () => [file], getAbstractFileByPath: (path: string) => path === file.path ? file : null, read, on, offref, modify, create },
    metadataCache: { getCache: () => null, resolvedLinks: {}, on, offref },
    workspace: { on, offref, onLayoutReady() {}, getActiveFile: () => file, getActiveViewOfType: () => ({ editor }), getLeavesOfType: () => [], detachLeavesOfType() {} },
  } as unknown as App;
  const PluginClass = pluginClass();
  let plugin = new PluginClass(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload();
  await host.commands.get("capture-research-selection")?.callback();
  expect(host.notices).toContain(RESEARCH.captured);
  expect(parsePersisted(host.data).state.researchLedger.records).toHaveLength(1);
  expect(JSON.stringify(host.data)).not.toContain(text);
  expect(modify).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalled();
  selection = { start: 0, end: 0 };
  await host.commands.get("capture-research-selection")?.callback(); expect(host.notices).toContain(RESEARCH.errors.RESEARCH_SELECTION_REQUIRED);
  selection = { start: 0, end: 4 }; editorText = "dirty unsaved";
  await host.commands.get("capture-research-selection")?.callback(); expect(host.notices).toContain(RESEARCH.errors.RESEARCH_DIRTY);
  editorText = text; selection = { start: 0, end: text.length };
  plugin.onunload(); await vi.waitFor(() => expect(listeners.size).toBe(0));
  plugin = new PluginClass(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload(); await host.commands.get("capture-research-selection")?.callback();
  expect(host.notices).toContain(RESEARCH.duplicate("captured"));
  const pending = host.commands.get("capture-research-selection")?.callback();
  plugin.onunload(); const noticeCount = host.notices.length; await pending;
  expect(host.notices).toHaveLength(noticeCount);
  await vi.waitFor(() => expect(listeners.size).toBe(0));
  expect(consoleError).not.toHaveBeenCalled();
});

it("opens the production research review from captured editor selection and closes on unload", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const { CONTROL_STARTERS } = await import("../../src/instructions");
  const { REVIEW } = await import("../../src/ui");
  const texts: Record<string, string> = { "Research.md": "Synthetic research selection", "Synapse/Instructions.md": CONTROL_STARTERS.instructions, "Synapse/Security.md": CONTROL_STARTERS.security };
  const files = Object.keys(texts).map((path) => Object.assign(new TFile(), { path, extension: "md", stat: { mtime: 1, ctime: 1, size: texts[path].length } }));
  const listeners = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
  const on = (name: string, callback: (...args: unknown[]) => void) => { const ref = {}; listeners.set(ref, { name, callback }); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  const editor = { getValue: () => texts["Research.md"], getCursor: (which: string) => ({ line: 0, ch: which === "from" ? 0 : texts["Research.md"].length }), posToOffset: ({ ch }: { ch: number }) => ch };
  const modify = vi.fn(); const create = vi.fn();
  const app = {
    vault: { adapter: {}, getFiles: () => files, getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null, read: async (file: TFile) => texts[file.path], on, offref, modify, create },
    metadataCache: { getCache: () => ({ frontmatter: {}, tags: [] }), resolvedLinks: {}, on, offref },
    workspace: { on, offref, onLayoutReady() {}, getActiveFile: () => files[0], getActiveViewOfType: () => ({ editor }), getLeavesOfType: () => [], detachLeavesOfType() {} },
  } as unknown as App;
  const open = vi.spyOn(obsidian.Modal.prototype, "open").mockImplementation(function (this: obsidian.Modal) { (this as obsidian.Modal & { onOpen(): void }).onOpen(); });
  const close = vi.spyOn(obsidian.Modal.prototype, "close").mockImplementation(function (this: obsidian.Modal) { (this as obsidian.Modal & { onClose(): void }).onClose(); });
  const PluginClass = pluginClass();
  const plugin = new PluginClass(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload();
  await vi.waitFor(() => { expect(listeners.size).toBeGreaterThan(0); });
  // The control loader resolves asynchronously during initial plugin startup.
  await vi.waitFor(async () => { await host.commands.get("review-research")?.callback(); expect(open).toHaveBeenCalledOnce(); });
  const modal = open.mock.instances[0] as unknown as obsidian.Modal;
  expect(modal.contentEl.textContent).toContain(REVIEW.title);
  expect(modal.contentEl.querySelector('input[type="checkbox"]')).not.toBeNull();
  expect(modal.contentEl.querySelector('input[type="date"]')).not.toBeNull();
  expect(modify).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  plugin.onunload(); expect(close).toHaveBeenCalled(); expect(modal.contentEl.childNodes).toHaveLength(0);
  await vi.waitFor(() => expect(listeners.size).toBe(0));
});
