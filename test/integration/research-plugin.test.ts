import { withMetadata } from "../note-metadata-fixture";
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

function pluginFolderAdapter() {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  return {
    exists: async (path: string) => files.has(path) || directories.has(path),
    read: async (path: string) => { const text = files.get(path); if (text === undefined) throw Error("missing plugin file"); return text; },
    write: async (path: string, text: string) => { files.set(path, text); },
    mkdir: async (path: string) => { directories.add(path); },
    remove: async (path: string) => { files.delete(path); },
  };
}

function pluginClass(): typeof VaultSynapsePlugin {
  if (process.env.SYNAPSE_SMOKE_BUNDLE !== "1") return VaultSynapsePlugin;
  const localRequire = createRequire(import.meta.url);
  const module = { exports: {} as { default: typeof VaultSynapsePlugin } };
  runInNewContext(readFileSync("main.js", "utf8"), {
    module, exports: module.exports, require: (name: string) => name === "obsidian" ? obsidian : localRequire(name),
    window, document, crypto, structuredClone, TextEncoder, TextDecoder, AbortController, performance, console, process, Date,
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
    vault: { adapter: pluginFolderAdapter(), getFiles: () => [file], getMarkdownFiles: () => [file], getAbstractFileByPath: (path: string) => path === file.path ? file : null, read, on, offref, modify, create },
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
  const texts: Record<string, string> = { "Research.md": "Synthetic research selection", "Synapse/Instructions.md": CONTROL_STARTERS.instructions };
  const files = Object.keys(texts).map((path) => Object.assign(new TFile(), { path, extension: "md", stat: { mtime: 1, ctime: 1, size: texts[path].length } }));
  const listeners = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
  const on = (name: string, callback: (...args: unknown[]) => void) => { const ref = {}; listeners.set(ref, { name, callback }); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  const editor = { getValue: () => texts["Research.md"], getCursor: (which: string) => ({ line: 0, ch: which === "from" ? 0 : texts["Research.md"].length }), posToOffset: ({ ch }: { ch: number }) => ch };
  const modify = vi.fn(); const create = vi.fn();
  const app = {
    vault: { adapter: pluginFolderAdapter(), getFiles: () => files, getMarkdownFiles: () => files, getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null, read: async (file: TFile) => texts[file.path], on, offref, modify, create },
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

it("applies a locally approved change through production composition without changing the inbox", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const { REVIEW } = await import("../../src/ui");
  const texts: Record<string, string> = {
    "Research.md": "Synthetic apply observation.", "Topic.md": withMetadata("# Original\nKeep this.\n"),
    "Synapse/Instructions.md": '---\n{"version":1,"timezone":"UTC","destinations":[{"id":"topic","path":"Topic.md"}],"daily":{"id":"daily-log","folder":"Daily","filename":"YYYY-MM-DD.md","heading":"## Log"}}\n---\nUse bullets.',
  };
  const files = Object.keys(texts).map((path) => Object.assign(new TFile(), { path, extension: "md", stat: { mtime: 1, ctime: 1, size: texts[path].length } }));
  const listeners = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
  const on = (name: string, callback: (...args: unknown[]) => void) => { const ref = {}; listeners.set(ref, { name, callback }); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  const emit = (name: string, file: TFile) => { for (const event of [...listeners.values()]) if (event.name === name) event.callback(file); };
  const editor = { getValue: () => texts["Research.md"], getCursor: (which: string) => ({ line: 0, ch: which === "from" ? 0 : texts["Research.md"].length }), posToOffset: ({ ch }: { ch: number }) => ch };
  const researchView = Object.assign(Object.create(obsidian.MarkdownView.prototype) as obsidian.MarkdownView, { file: files[0], editor });
  const processNote = vi.fn(async (file: TFile, update: (text: string) => string) => {
    texts[file.path] = update(texts[file.path]); ++file.stat.mtime; emit("modify", file); return texts[file.path];
  });
  const create = vi.fn(); const modify = vi.fn();
  const app = {
    vault: { adapter: pluginFolderAdapter(), getFiles: () => files, getAllLoadedFiles: () => files, getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
      read: async (file: TFile) => texts[file.path], process: processNote, on, offref, modify, create },
    metadataCache: { getCache: () => ({ frontmatter: {}, tags: [] }), resolvedLinks: {}, on, offref },
    workspace: { on, offref, onLayoutReady() {}, getActiveFile: () => files[0], getActiveViewOfType: () => researchView,
      getLeavesOfType: () => [{ view: researchView }], detachLeavesOfType() {} },
  } as unknown as App;
  const open = vi.spyOn(obsidian.Modal.prototype, "open").mockImplementation(function (this: obsidian.Modal) { (this as obsidian.Modal & { onOpen(): void }).onOpen(); });
  vi.spyOn(obsidian.Modal.prototype, "close").mockImplementation(function (this: obsidian.Modal) { (this as obsidian.Modal & { onClose(): void }).onClose(); });
  const PluginClass = pluginClass();
  const plugin = new PluginClass(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload();
  // Script only the provider response; command, queue, review, authority and writer are production.
  const lane = (plugin as unknown as { lane: { client: import("../../src/llm").ModelPort } }).lane;
  const generated = vi.fn(async <T,>() => ({ ok: true as const, value: { value: { changes: [{ destinationId: "D1", markdown: withMetadata("# Updated\nKeep this.\n- Synthetic result."), evidenceIds: ["E1"] }] } as T,
    attempts: 1 as const, usage: { promptTokens: 0, outputTokens: 0, loadMs: 0, promptEvalMs: 0, evalMs: 0, totalMs: 0 } } }));
  lane.client.generate = async <T,>() => { const result = await generated(); return { ...result, value: { ...result.value, value: result.value.value as T } }; };
  await vi.waitFor(async () => { await host.commands.get("review-research")?.callback(); expect(open).toHaveBeenCalledOnce(); });
  const el = (open.mock.instances[0] as unknown as obsidian.Modal).contentEl;
  const checkbox = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!; checkbox.checked = true; checkbox.dispatchEvent(new Event("change"));
  const button = (label: string) => Array.from(el.querySelectorAll("button")).find((candidate) => candidate.textContent === label)!;
  button(REVIEW.generate).click(); await vi.waitFor(() => expect(el.querySelector("select")).not.toBeNull());
  const select = el.querySelector("select")!; select.value = "accept"; select.dispatchEvent(new Event("change"));
  button(REVIEW.approve).click(); await vi.waitFor(() => expect(button(REVIEW.apply)).toBeDefined());
  expect(processNote).not.toHaveBeenCalled(); button(REVIEW.apply).click();
  await vi.waitFor(() => expect(el.textContent).toContain("Topic.md: Applied"));
  expect(processNote).toHaveBeenCalledOnce(); expect(modify).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  expect(texts["Topic.md"]).toBe(withMetadata("# Updated\nKeep this.\n- Synthetic result."));
  expect(texts["Research.md"]).toBe("Synthetic apply observation."); expect(generated).toHaveBeenCalledOnce();
  expect(parsePersisted(host.data).state.researchLedger.records[0].outcomes).toContain("applied");
  (open.mock.instances[0] as unknown as obsidian.Modal).close();
  await host.commands.get("review-recovery")?.callback();
  expect(open).toHaveBeenCalledTimes(2);
  const recoveryEl = (open.mock.instances[1] as unknown as obsidian.Modal).contentEl;
  const revert = Array.from(recoveryEl.querySelectorAll("button")).find((candidate) => candidate.textContent === "Review revert diff")!;
  revert.click(); await vi.waitFor(() => expect(recoveryEl.querySelector("select")).not.toBeNull());
  expect(Array.from(recoveryEl.querySelectorAll("pre")).map((pre) => pre.textContent)).toEqual([withMetadata("# Updated\nKeep this.\n- Synthetic result."), withMetadata("# Original\nKeep this.\n")]);
  const decision = recoveryEl.querySelector("select")!; decision.value = "accept"; decision.dispatchEvent(new Event("change"));
  const recoveryButton = (label: string) => Array.from(recoveryEl.querySelectorAll("button")).find((candidate) => candidate.textContent === label)!;
  recoveryButton(REVIEW.approve).click(); await vi.waitFor(() => expect(recoveryButton(REVIEW.apply)).toBeDefined());
  expect(processNote).toHaveBeenCalledOnce(); recoveryButton(REVIEW.apply).click();
  await vi.waitFor(() => expect(recoveryEl.textContent).toContain("Topic.md: Applied"));
  expect(processNote).toHaveBeenCalledTimes(2); expect(texts["Topic.md"]).toBe(withMetadata("# Original\nKeep this.\n"));
  expect(texts["Research.md"]).toBe("Synthetic apply observation."); expect(generated).toHaveBeenCalledOnce();
  plugin.onunload(); await vi.waitFor(() => expect(listeners.size).toBe(0));
});

it("composes authenticated inbox submission and durable retry through the shipped plugin", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const { request: httpRequest } = await import("node:http");
  const { CONTROL_STARTERS } = await import("../../src/instructions");
  const texts: Record<string, string> = {
    "Research.md": "Preserve original inbox.", "Synapse/Instructions.md": CONTROL_STARTERS.instructions,
  };
  const files = Object.keys(texts).map((path) => Object.assign(new TFile(), { path, extension: "md", stat: { mtime: 1, ctime: 1, size: texts[path].length } }));
  const adapter = pluginFolderAdapter();
  const listeners = new Map<object, { name: string; callback: (...args: unknown[]) => void }>();
  const on = (name: string, callback: (...args: unknown[]) => void) => { const ref = {}; listeners.set(ref, { name, callback }); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  const processNote = vi.fn(async (file: TFile, update: (text: string) => string) => {
    texts[file.path] = update(texts[file.path]); ++file.stat.mtime;
    for (const listener of [...listeners.values()]) if (listener.name === "modify") listener.callback(file);
    return texts[file.path];
  });
  const create = vi.fn();
  const app = {
    vault: { adapter, getFiles: () => files, getMarkdownFiles: () => files, getAllLoadedFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null, read: async (file: TFile) => texts[file.path], process: processNote, create, on, offref },
    metadataCache: { getCache: () => ({ frontmatter: {}, tags: [] }), resolvedLinks: {}, on, offref },
    workspace: { on, offref, onLayoutReady() {}, getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [], detachLeavesOfType() {} },
  } as unknown as App;
  const PluginClass = pluginClass();
  const plugin = new PluginClass(app, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  await plugin.onload();
  const mcp = (plugin as unknown as { mcp: import("../../src/core").McpServerPort }).mcp;
  const paired = await mcp.pair("Synthetic submitter", ["submit-research"]); await mcp.enable();
  let requestTime = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => requestTime);
  const post = (body: unknown) => new Promise<{ status: number | undefined; body: { result?: { structuredContent?: { status: string; receipt?: string }; isError?: boolean } } }>((resolve, reject) => {
    requestTime += 4000; // Refill transport tokens without a wall-clock sleep.
    const req = httpRequest(mcp.status().url!, { method: "POST", headers: { Authorization: `Bearer ${paired.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (chunk: string) => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) as { result?: { structuredContent?: { status: string; receipt?: string } } } : {} }));
    }); req.on("error", reject); req.end(JSON.stringify(body));
  });
  const ready = async () => {
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  };
  const submit = () => post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "submit_research", arguments: { idempotencyKey: "abcdefghijklmnop", text: "Synthetic external observation" } } });
  try {
    await ready();
    // A successful append emits a host source event, aborting late HTTP delivery.
    await submit();
    await vi.waitFor(() => expect(processNote).toHaveBeenCalledOnce());
    await ready();
    await vi.waitFor(async () => { const result = await submit(); expect(result.body.result?.structuredContent?.status).toBe("accepted"); });
    expect(texts["Research.md"]).toContain("Preserve original inbox.");
    expect(texts["Research.md"]).toContain("External unverified research");
    expect(create).not.toHaveBeenCalled(); expect(processNote).toHaveBeenCalledOnce();
    expect((await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "query_vault", arguments: { question: "private?" } } })).body.result?.isError).toBe(true);
  } finally { plugin.onunload(); }
  expect(mcp.status().url).toBeNull(); await vi.waitFor(() => expect(listeners.size).toBe(0));
});


it("clears production plugin history after local confirmation and reloads with settings and vault intact", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  const saved = defaultPersistedState(); saved.settings.apiKey = "synthetic-secret";
  saved.researchLedger = { ...saved.researchLedger, blocked: true }; host.data = saved;
  const adapter = pluginFolderAdapter();
  const listeners = new Set<object>();
  const on = () => { const ref = {}; listeners.add(ref); return ref; };
  const offref = (ref: object) => { listeners.delete(ref); };
  const modify = vi.fn(); const create = vi.fn();
  const app = {
    vault: { adapter, getFiles: () => [], getMarkdownFiles: () => [], getAbstractFileByPath: () => null, on, offref, modify, create },
    metadataCache: { getCache: () => null, resolvedLinks: {}, on, offref },
    workspace: { on, offref, onLayoutReady() {}, getLeavesOfType: () => [], detachLeavesOfType() {} },
  } as unknown as App;
  const open = vi.spyOn(obsidian.Modal.prototype, "open").mockImplementation(function (this: obsidian.Modal) { this.onOpen(); });
  vi.spyOn(obsidian.Modal.prototype, "close").mockImplementation(function (this: obsidian.Modal) { this.onClose(); });
  const PluginClass = pluginClass();
  const manifest = { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest;
  const plugin = new PluginClass(app, manifest); await plugin.onload();
  const folder = manifest.dir!;
  await adapter.write(`${folder}/mcp-receipts.json`, "synthetic history");
  await host.commands.get("clear-plugin-data")!.callback();
  const modal = open.mock.instances[0] as unknown as obsidian.Modal;
  expect(modal.contentEl.textContent).toContain("Recovery");
  expect(parsePersisted(host.data).state.researchLedger.blocked).toBe(true);
  modal.contentEl.querySelector("button")!.click();
  await vi.waitFor(() => expect(host.notices).toContain("Plugin data cleared. Reload Synapse to continue."));
  expect(listeners.size).toBe(0);
  expect(await adapter.exists(`${folder}/mcp-receipts.json`)).toBe(false);
  expect(await adapter.exists(`${folder}/recovery.json`)).toBe(false);
  expect(parsePersisted(host.data).state.settings).toEqual(saved.settings);
  expect(parsePersisted(host.data).state.researchLedger.blocked).toBe(false);
  expect(modify).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  const restart = new PluginClass(app, manifest); await restart.onload(); restart.onunload();
  await vi.waitFor(() => expect(listeners.size).toBe(0));
});

it("logs only a static event when initialization throws sensitive host data", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const plugin = new (pluginClass())({ vault: { adapter: pluginFolderAdapter() } } as unknown as App, { id: "vault-synapse", dir: ".obsidian/plugins/vault-synapse" } as PluginManifest);
  vi.spyOn(plugin, "loadData").mockRejectedValue(new Error("secret key note text Private.md"));
  await plugin.onload();
  expect(log).toHaveBeenCalledWith("Vault Synapse: failed to load");
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|Private/);
  plugin.onunload();
});
