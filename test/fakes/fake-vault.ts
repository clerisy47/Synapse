/**
 * In-memory VaultPort for CI (DESIGN §5.2 / §9). Markdown only.
 */

import {
  asVaultPath,
  type FileStat,
  type SourceKind,
  type VaultEvent,
  type VaultPath,
  type VaultPort,
  type Disposable,
} from "../../src/core";

export interface FakeVaultNoteSeed {
  path: string;
  text: string;
  mtime?: number;
  ctime?: number;
}


interface VaultEntry {
  kind: SourceKind;
  text?: string;
  mtime: number;
  ctime: number;
}

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function kindFromPath(path: string): SourceKind | null {
  return path.toLowerCase().endsWith(".md") ? "note" : null;
}

function byteLength(entry: VaultEntry): number {
  return new TextEncoder().encode(entry.text ?? "").byteLength;
}

function toStat(path: VaultPath, entry: VaultEntry): FileStat {
  return {
    path,
    kind: entry.kind,
    mtime: entry.mtime,
    ctime: entry.ctime,
    size: byteLength(entry),
  };
}

export class FakeVault implements VaultPort {
  private readonly files = new Map<string, VaultEntry>();
  private readonly listeners = new Set<(e: VaultEvent) => void>();
  private clock = 1_700_000_000_000;

  addNote(seed: FakeVaultNoteSeed): VaultPath {
    const path = normalizePath(seed.path);
    if (kindFromPath(path) !== "note") {
      throw new Error(`FakeVault: note path must end with .md: ${seed.path}`);
    }
    const mtime = seed.mtime ?? this.clock++;
    const ctime = seed.ctime ?? mtime;
    this.files.set(path, { kind: "note", text: seed.text, mtime, ctime });
    return path;
  }


  /** Remove a seeded path without emitting (tests control events explicitly). */
  remove(path: string): void {
    this.files.delete(normalizePath(path));
  }

  async listFiles(): Promise<FileStat[]> {
    const out: FileStat[] = [];
    for (const [path, entry] of this.files) {
      if (kindFromPath(path) === null) {
        continue;
      }
      out.push(toStat(path as VaultPath, entry));
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async stat(path: VaultPath): Promise<FileStat | null> {
    const key = normalizePath(path);
    const entry = this.files.get(key);
    if (!entry || kindFromPath(key) === null) {
      return null;
    }
    return toStat(key, entry);
  }

  async readText(path: VaultPath): Promise<string> {
    const key = normalizePath(path);
    const entry = this.files.get(key);
    if (!entry) {
      throw new Error(`FakeVault: missing path: ${key}`);
    }
    if (entry.kind !== "note") {
      throw new Error(`FakeVault: readText requires a note: ${key}`);
    }
    return entry.text ?? "";
  }


  onChange(cb: (e: VaultEvent) => void): Disposable {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emitCreate(path: string): void {
    this.emit({ type: "create", path: normalizePath(path) });
  }

  emitModify(path: string): void {
    this.emit({ type: "modify", path: normalizePath(path) });
  }

  emitDelete(path: string): void {
    this.emit({ type: "delete", path: normalizePath(path) });
  }

  emitRename(from: string, to: string): void {
    this.emit({
      type: "rename",
      from: normalizePath(from),
      to: normalizePath(to),
    });
  }

  private emit(e: VaultEvent): void {
    for (const cb of [...this.listeners]) {
      cb(e);
    }
  }
}
