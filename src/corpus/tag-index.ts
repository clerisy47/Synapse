/**
 * Tag index with nested expand at query time (DESIGN §4.2).
 * Tags are assumed already normalized (lowercase, no leading '#').
 */

import type { VaultPath } from "../core";

export interface TagQueryOptions {
  /** When true (default), `a` matches `a/b` (same rule as ExclusionPolicy). */
  nested?: boolean;
}

export interface TagIndex {
  /** Replace all tags for `path`. */
  upsert(path: VaultPath, tags: readonly string[]): void;
  remove(path: VaultPath): void;
  clear(): void;
  /**
   * Paths that carry `tag`. Nested expand: exact or `stored.startsWith(tag + "/")`.
   * Results are sorted for determinism.
   */
  pathsForTag(tag: string, opts?: TagQueryOptions): readonly VaultPath[];
  /** Distinct tags currently indexed, sorted. */
  tags(): readonly string[];
}

export function createTagIndex(): TagIndex {
  /** tag → set of paths */
  const byTag = new Map<string, Set<VaultPath>>();
  /** path → tags currently indexed for that path */
  const byPath = new Map<VaultPath, string[]>();

  function removePathFromTag(tag: string, path: VaultPath): void {
    const set = byTag.get(tag);
    if (!set) {
      return;
    }
    set.delete(path);
    if (set.size === 0) {
      byTag.delete(tag);
    }
  }

  function upsert(path: VaultPath, tags: readonly string[]): void {
    const prev = byPath.get(path);
    if (prev) {
      for (const t of prev) {
        removePathFromTag(t, path);
      }
    }
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      if (raw.length === 0 || seen.has(raw)) {
        continue;
      }
      seen.add(raw);
      unique.push(raw);
      let set = byTag.get(raw);
      if (!set) {
        set = new Set();
        byTag.set(raw, set);
      }
      set.add(path);
    }
    if (unique.length === 0) {
      byPath.delete(path);
    } else {
      byPath.set(path, unique);
    }
  }

  function remove(path: VaultPath): void {
    const prev = byPath.get(path);
    if (!prev) {
      return;
    }
    for (const t of prev) {
      removePathFromTag(t, path);
    }
    byPath.delete(path);
  }

  function clear(): void {
    byTag.clear();
    byPath.clear();
  }

  function pathsForTag(tag: string, opts?: TagQueryOptions): readonly VaultPath[] {
    if (tag.length === 0) {
      return [];
    }
    const nested = opts?.nested !== false;
    const out = new Set<VaultPath>();
    if (nested) {
      for (const [stored, paths] of byTag) {
        if (stored === tag || stored.startsWith(`${tag}/`)) {
          for (const p of paths) {
            out.add(p);
          }
        }
      }
    } else {
      const exact = byTag.get(tag);
      if (exact) {
        for (const p of exact) {
          out.add(p);
        }
      }
    }
    return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  function tags(): readonly string[] {
    return [...byTag.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  return { upsert, remove, clear, pathsForTag, tags };
}
