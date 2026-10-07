/**
 * Folded-text body index (DESIGN §4.1 / §4.2). Notes only; PDFs are M4.
 * Originals are not stored — callers re-read and cutSnippet for excerpts.
 */

import type { Clock, VaultPath } from "../core";
import { bodyStartOffset, foldCase } from "../core";

export interface TextIndexEntry {
  folded: string;
  bodyStart: number;
}

export interface TextScanHit {
  path: VaultPath;
  start: number;
  end: number;
}

export interface TextScanOptions {
  /** Raw terms; folded inside scan. Empty terms are ignored. */
  terms: readonly string[];
  clock: Clock;
  sliceMs: number;
  budgetMs: number;
  signal?: AbortSignal;
}

export interface TextScanResult {
  hits: TextScanHit[];
  truncated: boolean;
}

export interface TextIndex {
  upsert(path: VaultPath, originalText: string): void;
  remove(path: VaultPath): void;
  get(path: VaultPath): TextIndexEntry | null;
  has(path: VaultPath): boolean;
  paths(): readonly VaultPath[];
  clear(): void;
  /** Sum of stored folded string lengths (F-26 cap deferred). */
  bytesCached(): number;
  scan(opts: TextScanOptions): Promise<TextScanResult>;
}

/** Verbatim slice for snippets / evidence (offsets into full-file original). */
export function cutSnippet(original: string, start: number, end: number): string {
  return original.slice(start, end);
}

export function createTextIndex(): TextIndex {
  const entries = new Map<VaultPath, TextIndexEntry>();
  let cached = 0;

  function upsert(path: VaultPath, originalText: string): void {
    const prev = entries.get(path);
    if (prev) {
      cached -= prev.folded.length;
    }
    const folded = foldCase(originalText);
    const bodyStart = bodyStartOffset(originalText);
    entries.set(path, { folded, bodyStart });
    cached += folded.length;
  }

  function remove(path: VaultPath): void {
    const prev = entries.get(path);
    if (!prev) {
      return;
    }
    cached -= prev.folded.length;
    entries.delete(path);
  }

  function get(path: VaultPath): TextIndexEntry | null {
    return entries.get(path) ?? null;
  }

  function has(path: VaultPath): boolean {
    return entries.has(path);
  }

  function paths(): readonly VaultPath[] {
    return [...entries.keys()];
  }

  function clear(): void {
    entries.clear();
    cached = 0;
  }

  function bytesCached(): number {
    return cached;
  }

  async function scan(opts: TextScanOptions): Promise<TextScanResult> {
    const foldedTerms = opts.terms
      .map((t) => foldCase(t))
      .filter((t) => t.length > 0);
    const hits: TextScanHit[] = [];
    if (foldedTerms.length === 0) {
      return { hits, truncated: false };
    }

    const started = opts.clock.mono();
    let lastYield = started;
    let truncated = false;

    const aborted = (): boolean => opts.signal?.aborted === true;
    const overBudget = (): boolean =>
      opts.clock.mono() - started >= opts.budgetMs;

    for (const [path, entry] of entries) {
      if (aborted() || overBudget()) {
        truncated = true;
        break;
      }

      const now = opts.clock.mono();
      if (now - lastYield >= opts.sliceMs) {
        await opts.clock.yieldNow();
        lastYield = opts.clock.mono();
        if (aborted() || overBudget()) {
          truncated = true;
          break;
        }
      }

      const { folded, bodyStart } = entry;
      const body = folded.slice(bodyStart);
      for (const term of foldedTerms) {
        let from = 0;
        while (from <= body.length - term.length) {
          const at = body.indexOf(term, from);
          if (at < 0) {
            break;
          }
          const start = bodyStart + at;
          hits.push({ path, start, end: start + term.length });
          from = at + 1;
        }
      }
    }

    return { hits, truncated };
  }

  return {
    upsert,
    remove,
    get,
    has,
    paths,
    clear,
    bytesCached,
    scan,
  };
}
