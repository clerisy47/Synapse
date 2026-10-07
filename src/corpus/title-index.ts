/**
 * Title/alias index for linear search (DESIGN §4.2).
 * Stores foldCase forms only; originals are not kept.
 */

import { foldCase, type VaultPath } from "../core";

export type TitleMatchOn = "title" | "alias";

export interface TitleIndexEntry {
  path: VaultPath;
  titleFolded: string;
  aliasesFolded: string[];
}

export interface TitleSearchHit {
  path: VaultPath;
  matchedOn: TitleMatchOn;
}

export interface TitleIndex {
  upsert(path: VaultPath, title: string, aliases: readonly string[]): void;
  remove(path: VaultPath): void;
  clear(): void;
  get(path: VaultPath): TitleIndexEntry | null;
  /**
   * Substring match on folded title/aliases.
   * Prefer `title` when both title and an alias match.
   */
  search(query: string): TitleSearchHit[];
}

export function createTitleIndex(): TitleIndex {
  const entries = new Map<VaultPath, TitleIndexEntry>();
  /** Stable iteration order for deterministic search. */
  const order: VaultPath[] = [];

  function upsert(path: VaultPath, title: string, aliases: readonly string[]): void {
    if (!entries.has(path)) {
      order.push(path);
    }
    const aliasesFolded: string[] = [];
    const seen = new Set<string>();
    for (const a of aliases) {
      const folded = foldCase(a);
      if (folded.length === 0 || seen.has(folded)) {
        continue;
      }
      seen.add(folded);
      aliasesFolded.push(folded);
    }
    entries.set(path, {
      path,
      titleFolded: foldCase(title),
      aliasesFolded,
    });
  }

  function remove(path: VaultPath): void {
    if (!entries.delete(path)) {
      return;
    }
    const i = order.indexOf(path);
    if (i >= 0) {
      order.splice(i, 1);
    }
  }

  function clear(): void {
    entries.clear();
    order.length = 0;
  }

  function get(path: VaultPath): TitleIndexEntry | null {
    return entries.get(path) ?? null;
  }

  function search(query: string): TitleSearchHit[] {
    const q = foldCase(query.trim());
    if (q.length === 0) {
      return [];
    }
    const hits: TitleSearchHit[] = [];
    for (const path of order) {
      const entry = entries.get(path);
      if (!entry) {
        continue;
      }
      if (entry.titleFolded.includes(q)) {
        hits.push({ path, matchedOn: "title" });
        continue;
      }
      for (const alias of entry.aliasesFolded) {
        if (alias.includes(q)) {
          hits.push({ path, matchedOn: "alias" });
          break;
        }
      }
    }
    return hits;
  }

  return { upsert, remove, clear, get, search };
}
