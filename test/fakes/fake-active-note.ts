/**
 * In-memory ActiveNotePort for CI (DESIGN §5.2 / §9).
 */

import {
  asVaultPath,
  type ActiveNotePort,
  type Disposable,
  type VaultPath,
} from "../../src/core";

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

export class FakeActiveNote implements ActiveNotePort {
  private active: {
    path: VaultPath;
    text: string;
    selection?: { start: number; end: number };
  } | null = null;
  private open: VaultPath[] = [];
  private readonly listeners = new Set<
    (e: { type: "open" | "edit"; path: VaultPath }) => void
  >();

  setCurrent(
    path: string | null,
    text = "",
    selection?: { start: number; end: number },
  ): void {
    if (path === null) {
      this.active = null;
      return;
    }
    const p = normalizePath(path);
    this.active = selection
      ? { path: p, text, selection }
      : { path: p, text };
  }

  setOpenNotes(paths: readonly string[]): void {
    this.open = paths.map(normalizePath);
  }

  emitOpen(path: string): void {
    const p = normalizePath(path);
    for (const cb of [...this.listeners]) {
      cb({ type: "open", path: p });
    }
  }

  emitEdit(path: string): void {
    const p = normalizePath(path);
    for (const cb of [...this.listeners]) {
      cb({ type: "edit", path: p });
    }
  }

  current() {
    return this.active;
  }

  openNotes(): VaultPath[] {
    return [...this.open];
  }

  onActivity(
    cb: (e: { type: "open" | "edit"; path: VaultPath }) => void,
  ): Disposable {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}
