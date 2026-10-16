import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "../core";
import { createPrivacyStorage } from "./privacy";
import { defaultPersistedState, parsePersisted } from "./parse";

function fixture() {
  const files = new Map<string, unknown>([["recovery.json", "note body"], ["mcp-receipts.json", "receipt"], ["mcp-grants.json", "grant"], ["main.js", "asset"]]);
  let data: unknown = null;
  const removeDir = vi.fn();
  const raw: StoragePort = {
    readJson: async (path) => files.get(path) ?? null,
    writeJson: async (path, value) => { files.set(path, value); },
    remove: async (path) => { files.delete(path); }, list: async () => [...files.keys()], removeDir,
    loadData: async () => data, saveData: async (value) => { data = value; }, onExternalDataChange: () => () => {},
  };
  return { files, raw, removeDir, ...createPrivacyStorage(raw) };
}

describe("privacy erasure", () => {
  it("preserves exact settings across restart and clears only owned state", async () => {
    const f = fixture(); const state = defaultPersistedState();
    state.settings.apiKey = "private-key"; state.settings.excludedFolders = ["Private"];
    state.settingsUpdatedAt = 42; state.researchLedger = { ...state.researchLedger, blocked: true }; state.unknown = "private-history";
    const expectedSettings = structuredClone(state.settings);
    const stop = vi.fn();
    await f.clear(state, stop);
    const restart = parsePersisted(await f.raw.loadData()).state;
    expect(restart.settings).toEqual(expectedSettings); expect(restart.settingsUpdatedAt).toBe(42);
    expect(restart.touchLog).toEqual({}); expect(restart.researchLedger).toEqual(defaultPersistedState().researchLedger);
    expect(restart.unknown).toBeUndefined(); expect([...f.files]).toEqual([["main.js", "asset"]]);
    expect(stop).toHaveBeenCalledOnce(); expect(f.removeDir).not.toHaveBeenCalled();
  });
  it("drains an in-flight write and refuses late writes before deletion", async () => {
    const f = fixture(); let finish!: () => void;
    f.raw.writeJson = async (path, value) => { await new Promise<void>((resolve) => { finish = resolve; }); f.files.set(path, value); };
    const writing = f.storage.writeJson("recovery.json", "late body");
    const clearing = f.clear(defaultPersistedState(), () => {});
    await expect(f.storage.writeJson("recovery.json", "restore")).rejects.toThrow("Storage stopped");
    finish(); await writing; await clearing;
    expect(f.files.has("recovery.json")).toBe(false);
    await expect(f.storage.saveData({ secret: "restore" })).rejects.toThrow("Storage stopped");
  });
  it("reports storage failure without restarting writers", async () => {
    const f = fixture(); f.raw.remove = async () => { throw new Error("private path"); };
    await expect(f.clear(defaultPersistedState(), () => {})).rejects.toThrow();
    await expect(f.storage.saveData({})).rejects.toThrow("Storage stopped");
  });
});
