/**
 * Path guard + ObsidianStorage against an in-memory adapter (M1-T13).
 */

import { describe, expect, it } from "vitest";

import {
  createObsidianStorage,
  resolvePluginRel,
  type PluginFolderAdapter,
} from "./storage";

/** Fake vault-relative plugin folder (not the configurable config dir name). */
const PLUGIN_DIR = "plugins/vault-synapse";

function memoryAdapter(): PluginFolderAdapter & {
  files: Map<string, string>;
  dirs: Set<string>;
  writePaths: string[];
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>([PLUGIN_DIR]);
  const writePaths: string[] = [];

  const ensureUnderPlugin = (path: string): void => {
    const norm = path.replace(/\\/g, "/");
    if (norm !== PLUGIN_DIR && !norm.startsWith(`${PLUGIN_DIR}/`)) {
      throw new Error(`path outside plugin folder: ${path}`);
    }
  };

  return {
    files,
    dirs,
    writePaths,
    async read(normalizedPath: string): Promise<string> {
      ensureUnderPlugin(normalizedPath);
      const v = files.get(normalizedPath);
      if (v === undefined) {
        throw new Error(`missing: ${normalizedPath}`);
      }
      return v;
    },
    async write(normalizedPath: string, data: string): Promise<void> {
      ensureUnderPlugin(normalizedPath);
      writePaths.push(normalizedPath);
      files.set(normalizedPath, data);
      const i = normalizedPath.lastIndexOf("/");
      if (i > 0) {
        dirs.add(normalizedPath.slice(0, i));
      }
    },
    async exists(normalizedPath: string): Promise<boolean> {
      return files.has(normalizedPath) || dirs.has(normalizedPath);
    },
    async list(
      normalizedPath: string,
    ): Promise<{ files: string[]; folders: string[] }> {
      ensureUnderPlugin(normalizedPath);
      const prefix = `${normalizedPath}/`;
      const outFiles: string[] = [];
      const outFolders: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) {
          outFiles.push(key);
        }
      }
      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        if (rest.length > 0 && !rest.includes("/")) {
          outFolders.push(dir);
        }
      }
      return { files: outFiles, folders: outFolders };
    },
    async mkdir(normalizedPath: string): Promise<void> {
      ensureUnderPlugin(normalizedPath);
      dirs.add(normalizedPath);
    },
    async remove(normalizedPath: string): Promise<void> {
      ensureUnderPlugin(normalizedPath);
      files.delete(normalizedPath);
    },
    async rmdir(normalizedPath: string, _recursive: boolean): Promise<void> {
      ensureUnderPlugin(normalizedPath);
      dirs.delete(normalizedPath);
      for (const key of [...files.keys()]) {
        if (key === normalizedPath || key.startsWith(`${normalizedPath}/`)) {
          files.delete(key);
        }
      }
      for (const dir of [...dirs]) {
        if (dir.startsWith(`${normalizedPath}/`)) {
          dirs.delete(dir);
        }
      }
    },
  };
}

describe("resolvePluginRel", () => {
  it("joins under pluginDir", () => {
    expect(resolvePluginRel(PLUGIN_DIR, "cache/foo.json")).toBe(
      `${PLUGIN_DIR}/cache/foo.json`,
    );
  });

  it("rejects .. segments", () => {
    expect(() => resolvePluginRel(PLUGIN_DIR, "../escape.md")).toThrow(
      /escapes plugin folder/,
    );
    expect(() => resolvePluginRel(PLUGIN_DIR, "a/../../x")).toThrow(
      /escapes plugin folder/,
    );
  });

  it("rejects absolute and drive-letter paths", () => {
    expect(() => resolvePluginRel(PLUGIN_DIR, "/etc/passwd")).toThrow(
      /escapes plugin folder/,
    );
    expect(() => resolvePluginRel(PLUGIN_DIR, "C:/Windows")).toThrow(
      /escapes plugin folder/,
    );
  });

  it("rejects empty pluginDir", () => {
    expect(() => resolvePluginRel("", "a.json")).toThrow(/pluginDir is empty/);
  });
});

describe("createObsidianStorage", () => {
  it("writes JSON only under the plugin folder", async () => {
    const adapter = memoryAdapter();
    let saved: unknown = null;
    const storage = createObsidianStorage({
      pluginDir: PLUGIN_DIR,
      loadData: async () => saved,
      saveData: async (v) => {
        saved = v;
      },
      adapter,
    });

    await storage.writeJson("cache/x.json", { a: 1 });
    expect(adapter.writePaths).toEqual([`${PLUGIN_DIR}/cache/x.json`]);
    expect(await storage.readJson("cache/x.json")).toEqual({ a: 1 });
  });

  it("rejects escape on writeJson", async () => {
    const adapter = memoryAdapter();
    const storage = createObsidianStorage({
      pluginDir: PLUGIN_DIR,
      loadData: async () => null,
      saveData: async () => {},
      adapter,
    });
    await expect(storage.writeJson("../notes.md", { x: 1 })).rejects.toThrow(
      /escapes plugin folder/,
    );
    expect(adapter.writePaths).toEqual([]);
  });

  it("returns null for missing readJson", async () => {
    const adapter = memoryAdapter();
    const storage = createObsidianStorage({
      pluginDir: PLUGIN_DIR,
      loadData: async () => null,
      saveData: async () => {},
      adapter,
    });
    expect(await storage.readJson("missing.json")).toBeNull();
  });

  it("loadData/saveData and external change notify", async () => {
    const adapter = memoryAdapter();
    let saved: unknown = undefined;
    const storage = createObsidianStorage({
      pluginDir: PLUGIN_DIR,
      loadData: async () => saved,
      saveData: async (v) => {
        saved = v;
      },
      adapter,
    });

    expect(await storage.loadData()).toBeNull();
    await storage.saveData({ v: 1 });
    expect(await storage.loadData()).toEqual({ v: 1 });

    let fired = 0;
    const dispose = storage.onExternalDataChange(() => {
      fired += 1;
    });
    storage.notifyExternalDataChange();
    expect(fired).toBe(1);
    dispose();
    storage.notifyExternalDataChange();
    expect(fired).toBe(1);
  });

  it("list and removeDir stay under pluginDir", async () => {
    const adapter = memoryAdapter();
    const storage = createObsidianStorage({
      pluginDir: PLUGIN_DIR,
      loadData: async () => null,
      saveData: async () => {},
      adapter,
    });
    await storage.writeJson("cache/a.json", { a: 1 });
    await storage.writeJson("cache/b.json", { b: 2 });
    expect(await storage.list("cache")).toEqual(["a.json", "b.json"]);
    await storage.removeDir("cache");
    expect(await storage.readJson("cache/a.json")).toBeNull();
  });
});
