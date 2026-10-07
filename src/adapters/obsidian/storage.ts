/**
 * Obsidian StoragePort — plugin-folder confined (DESIGN §5.2, AC-M8.5).
 * The only writer in the codebase; vault.adapter is used only under pluginDir.
 */

import type { Plugin } from "obsidian";

import type { Disposable, StoragePort } from "../../core";

/** Minimal DataAdapter surface used by this port (testable without Obsidian). */
export type PluginFolderAdapter = {
  read(normalizedPath: string): Promise<string>;
  write(normalizedPath: string, data: string): Promise<void>;
  exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  list(
    normalizedPath: string,
  ): Promise<{ files: string[]; folders: string[] }>;
  mkdir(normalizedPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  rmdir(normalizedPath: string, recursive: boolean): Promise<void>;
};

export type CreateObsidianStorageOptions = {
  pluginDir: string;
  loadData: () => Promise<unknown>;
  saveData: (v: unknown) => Promise<void>;
  adapter: PluginFolderAdapter;
};

export type ObsidianStorage = StoragePort & {
  /** Bridge for Plugin.onExternalSettingsChange (lifecycle). */
  notifyExternalDataChange(): void;
};

/**
 * Resolve a plugin-relative path under `pluginDir`.
 * Rejects `..`, absolute paths, and drive-letter paths.
 */
export function resolvePluginRel(pluginDir: string, rel: string): string {
  const base = normalizeDir(pluginDir);
  if (base.length === 0) {
    throw new Error("ObsidianStorage: pluginDir is empty");
  }
  if (isAbsoluteRel(rel)) {
    throw new Error(`ObsidianStorage: path escapes plugin folder: ${rel}`);
  }
  const trimmed = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (trimmed === "" || trimmed === ".") {
    return base;
  }
  const parts: string[] = [];
  for (const p of trimmed.split("/")) {
    if (p === "" || p === ".") {
      continue;
    }
    if (p === "..") {
      throw new Error(`ObsidianStorage: path escapes plugin folder: ${rel}`);
    }
    parts.push(p);
  }
  if (parts.length === 0) {
    return base;
  }
  return `${base}/${parts.join("/")}`;
}

export function createObsidianStorage(
  opts: CreateObsidianStorageOptions,
): ObsidianStorage {
  const pluginDir = normalizeDir(opts.pluginDir);
  if (pluginDir.length === 0) {
    throw new Error("ObsidianStorage: pluginDir is required");
  }

  const { adapter, loadData, saveData } = opts;
  const externalListeners = new Set<() => void>();

  const resolve = (rel: string): string => resolvePluginRel(pluginDir, rel);

  return {
    async readJson(rel: string): Promise<unknown> {
      const path = resolve(rel);
      if (!(await adapter.exists(path))) {
        return null;
      }
      const raw = await adapter.read(path);
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new Error(`ObsidianStorage: invalid JSON at ${rel}`);
      }
    },

    async writeJson(rel: string, v: unknown): Promise<void> {
      const path = resolve(rel);
      await ensureParentDirs(adapter, path);
      await adapter.write(path, JSON.stringify(v));
    },

    async remove(rel: string): Promise<void> {
      const path = resolve(rel);
      if (await adapter.exists(path)) {
        await adapter.remove(path);
      }
    },

    async list(relDir: string): Promise<string[]> {
      const path = resolve(relDir);
      if (!(await adapter.exists(path))) {
        return [];
      }
      const listed = await adapter.list(path);
      const names = new Set<string>();
      for (const full of [...listed.files, ...listed.folders]) {
        const name = basename(full);
        if (name.length > 0) {
          names.add(name);
        }
      }
      return [...names].sort();
    },

    async removeDir(relDir: string): Promise<void> {
      const path = resolve(relDir);
      if (await adapter.exists(path)) {
        await adapter.rmdir(path, true);
      }
    },

    async loadData(): Promise<unknown> {
      const raw = await loadData();
      return raw === undefined ? null : raw;
    },

    async saveData(v: unknown): Promise<void> {
      await saveData(v);
    },

    onExternalDataChange(cb: () => void): Disposable {
      externalListeners.add(cb);
      return () => {
        externalListeners.delete(cb);
      };
    },

    notifyExternalDataChange(): void {
      for (const cb of [...externalListeners]) {
        cb();
      }
    },
  };
}

/** Build storage from a live Obsidian Plugin (composition root). */
export function createObsidianStorageFromPlugin(
  plugin: Plugin,
): ObsidianStorage {
  const dir = plugin.manifest.dir;
  if (dir === undefined || dir.length === 0) {
    throw new Error("ObsidianStorage: plugin.manifest.dir is missing");
  }
  return createObsidianStorage({
    pluginDir: dir,
    loadData: () => plugin.loadData(),
    saveData: (v) => plugin.saveData(v),
    adapter: plugin.app.vault.adapter,
  });
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
}

function isAbsoluteRel(rel: string): boolean {
  if (rel.startsWith("/") || rel.startsWith("\\")) {
    return true;
  }
  // Windows drive letter (e.g. C:\ or C:/)
  if (/^[a-zA-Z]:[\\/]/.test(rel)) {
    return true;
  }
  return false;
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

async function ensureParentDirs(
  adapter: PluginFolderAdapter,
  filePath: string,
): Promise<void> {
  const norm = filePath.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  if (i <= 0) {
    return;
  }
  const parent = norm.slice(0, i);
  if (parent.length === 0 || (await adapter.exists(parent))) {
    return;
  }
  await ensureParentDirs(adapter, parent);
  if (!(await adapter.exists(parent))) {
    await adapter.mkdir(parent);
  }
}
