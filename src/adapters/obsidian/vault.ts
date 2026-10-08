/**
 * Obsidian VaultPort — .md / .pdf only (DESIGN §5.2 / AC-M2.2).
 */

import { TFile, type App, type TAbstractFile } from "obsidian";

import {
  asVaultPath,
  type Disposable,
  type FileStat,
  type SourceKind,
  type VaultEvent,
  type VaultPath,
  type VaultPort,
} from "../../core";

/** Minimal file surface used by this port (testable without Obsidian). */
export type VaultFileLike = {
  path: string;
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
};

type VaultEventName = "create" | "modify" | "delete" | "rename";

/** Minimal vault surface used by this port. */
export type VaultAdapterSurface = {
  getFiles(): VaultFileLike[];
  getAbstractFileByPath(path: string): VaultFileLike | null;
  read(file: VaultFileLike): Promise<string>;
  readBinary(file: VaultFileLike): Promise<ArrayBuffer>;
  on(
    event: VaultEventName,
    cb: (file: VaultFileLike, oldPath?: string) => void,
  ): Disposable;
};

function kindFromExtension(ext: string): SourceKind | null {
  const lower = ext.toLowerCase();
  if (lower === "md") {
    return "note";
  }
  if (lower === "pdf") {
    return "pdf";
  }
  return null;
}

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function extFromPath(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

function toStat(file: VaultFileLike): FileStat | null {
  const kind = kindFromExtension(file.extension);
  if (kind === null) {
    return null;
  }
  return {
    path: normalizePath(file.path),
    kind,
    mtime: file.stat.mtime,
    ctime: file.stat.ctime,
    size: file.stat.size,
  };
}

function isCorpusFile(file: VaultFileLike): boolean {
  return kindFromExtension(file.extension) !== null;
}

export function createObsidianVault(vault: VaultAdapterSurface): VaultPort {
  return {
    async listFiles(): Promise<FileStat[]> {
      const out: FileStat[] = [];
      for (const file of vault.getFiles()) {
        const stat = toStat(file);
        if (stat) {
          out.push(stat);
        }
      }
      out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return out;
    },

    async stat(path: VaultPath): Promise<FileStat | null> {
      const key = normalizePath(path);
      const file = vault.getAbstractFileByPath(key);
      if (!file || !isCorpusFile(file)) {
        return null;
      }
      return toStat(file);
    },

    async readText(path: VaultPath): Promise<string> {
      const key = normalizePath(path);
      const file = vault.getAbstractFileByPath(key);
      if (!file) {
        throw new Error(`ObsidianVault: missing path: ${key}`);
      }
      if (kindFromExtension(file.extension) !== "note") {
        throw new Error(`ObsidianVault: readText requires a note: ${key}`);
      }
      return vault.read(file);
    },

    async readBinary(path: VaultPath): Promise<ArrayBuffer> {
      const key = normalizePath(path);
      const file = vault.getAbstractFileByPath(key);
      if (!file) {
        throw new Error(`ObsidianVault: missing path: ${key}`);
      }
      if (kindFromExtension(file.extension) !== "pdf") {
        throw new Error(`ObsidianVault: readBinary requires a pdf: ${key}`);
      }
      return vault.readBinary(file);
    },

    onChange(cb: (e: VaultEvent) => void): Disposable {
      const emitPath = (
        type: "create" | "modify" | "delete",
        file: VaultFileLike,
      ): void => {
        if (!isCorpusFile(file)) {
          return;
        }
        cb({ type, path: normalizePath(file.path) });
      };

      const dCreate = vault.on("create", (file) => {
        emitPath("create", file);
      });
      const dModify = vault.on("modify", (file) => {
        emitPath("modify", file);
      });
      const dDelete = vault.on("delete", (file) => {
        emitPath("delete", file);
      });
      const dRename = vault.on("rename", (file, oldPath) => {
        if (oldPath === undefined) {
          return;
        }
        const fromKind = kindFromExtension(extFromPath(oldPath));
        const toKind = kindFromExtension(file.extension);
        if (fromKind === null && toKind === null) {
          return;
        }
        cb({
          type: "rename",
          from: normalizePath(oldPath),
          to: normalizePath(file.path),
        });
      });

      return () => {
        dCreate();
        dModify();
        dDelete();
        dRename();
      };
    },
  };
}

/** Live App → VaultPort. */
export function createObsidianVaultFromApp(app: App): VaultPort {
  const v = app.vault;

  function resolveFile(path: string): TFile | null {
    const abs = v.getAbstractFileByPath(path);
    return abs instanceof TFile ? abs : null;
  }

  const surface: VaultAdapterSurface = {
    getFiles(): VaultFileLike[] {
      return v.getFiles();
    },
    getAbstractFileByPath(path: string): VaultFileLike | null {
      return resolveFile(path);
    },
    read(file: VaultFileLike): Promise<string> {
      const tfile = resolveFile(file.path);
      if (!tfile) {
        throw new Error(`ObsidianVault: missing path: ${file.path}`);
      }
      return v.read(tfile);
    },
    readBinary(file: VaultFileLike): Promise<ArrayBuffer> {
      const tfile = resolveFile(file.path);
      if (!tfile) {
        throw new Error(`ObsidianVault: missing path: ${file.path}`);
      }
      return v.readBinary(tfile);
    },
    on(event, cb): Disposable {
      // Obsidian overloads create/modify/delete vs rename; widen via cast.
      const ref = v.on(
        event as "create",
        ((file: TAbstractFile, oldPath?: string) => {
          if (!(file instanceof TFile)) {
            return;
          }
          cb(file, oldPath);
        }) as (file: TAbstractFile) => void,
      );
      return () => {
        v.offref(ref);
      };
    },
  };
  return createObsidianVault(surface);
}
