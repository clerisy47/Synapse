/**
 * In-memory StoragePort for CI (DESIGN §5.2). Plugin-folder semantics only.
 */

import type { Disposable, StoragePort } from "../../src/core";

const DATA_KEY = "__data__";

function normalizeRel(rel: string): string {
  const trimmed = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (trimmed === "" || trimmed === ".") {
    return "";
  }
  const parts: string[] = [];
  for (const p of trimmed.split("/")) {
    if (p === "" || p === ".") {
      continue;
    }
    if (p === "..") {
      throw new Error(`MemoryStorage: path escapes plugin folder: ${rel}`);
    }
    parts.push(p);
  }
  return parts.join("/");
}

function isUnderDir(path: string, dir: string): boolean {
  if (dir === "") {
    return path !== "" && path !== DATA_KEY;
  }
  return path === dir || path.startsWith(`${dir}/`);
}

export class MemoryStorage implements StoragePort {
  private readonly files = new Map<string, unknown>();
  private readonly externalListeners = new Set<() => void>();

  async readJson(rel: string): Promise<unknown> {
    const key = normalizeRel(rel);
    if (!this.files.has(key)) {
      return null;
    }
    return structuredClone(this.files.get(key));
  }

  async writeJson(rel: string, v: unknown): Promise<void> {
    const key = normalizeRel(rel);
    this.files.set(key, structuredClone(v));
  }

  async remove(rel: string): Promise<void> {
    const key = normalizeRel(rel);
    this.files.delete(key);
  }

  async list(relDir: string): Promise<string[]> {
    const dir = normalizeRel(relDir);
    const prefix = dir === "" ? "" : `${dir}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key === DATA_KEY) {
        continue;
      }
      if (dir === "") {
        const top = key.split("/")[0];
        if (top) {
          names.add(top);
        }
        continue;
      }
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rest = key.slice(prefix.length);
      if (rest === "") {
        continue;
      }
      const name = rest.split("/")[0];
      if (name) {
        names.add(name);
      }
    }
    return [...names].sort();
  }

  async removeDir(relDir: string): Promise<void> {
    const dir = normalizeRel(relDir);
    for (const key of [...this.files.keys()]) {
      if (key === DATA_KEY) {
        continue;
      }
      if (isUnderDir(key, dir)) {
        this.files.delete(key);
      }
    }
  }

  async loadData(): Promise<unknown> {
    if (!this.files.has(DATA_KEY)) {
      return null;
    }
    return structuredClone(this.files.get(DATA_KEY));
  }

  async saveData(v: unknown): Promise<void> {
    this.files.set(DATA_KEY, structuredClone(v));
  }

  onExternalDataChange(cb: () => void): Disposable {
    this.externalListeners.add(cb);
    return () => {
      this.externalListeners.delete(cb);
    };
  }

  /** Test helper: fire `onExternalDataChange` listeners. */
  emitExternalDataChange(): void {
    for (const cb of [...this.externalListeners]) {
      cb();
    }
  }
}
