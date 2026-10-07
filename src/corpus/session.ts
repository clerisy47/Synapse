/**
 * SessionTracker — user open/edit activity window (DESIGN §4.2 / F-15).
 * Fed by ActiveNotePort later; never by vault modify events.
 */

import type { VaultPath } from "../core";

export interface SessionTracker {
  touch(path: VaultPath, atMs: number): void;
  lastTouched(path: VaultPath): number | undefined;
  /** Paths with lastActivityMs >= sinceMs. */
  touchedSince(sinceMs: number): VaultPath[];
  clear(): void;
}

export function createSessionTracker(): SessionTracker {
  const last = new Map<VaultPath, number>();

  return {
    touch(path, atMs): void {
      const prev = last.get(path);
      if (prev === undefined || atMs >= prev) {
        last.set(path, atMs);
      }
    },

    lastTouched(path): number | undefined {
      return last.get(path);
    },

    touchedSince(sinceMs): VaultPath[] {
      const out: VaultPath[] = [];
      for (const [path, at] of last) {
        if (at >= sinceMs) {
          out.push(path);
        }
      }
      return out;
    },

    clear(): void {
      last.clear();
    },
  };
}
