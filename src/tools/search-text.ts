/**
 * search_text tool (DESIGN §5.4) — folded literal scan + deterministic ranking.
 */

import {
  foldCase,
  sha1Hex,
  type DocMeta,
  type Excerpt,
  type VaultPath,
} from "../core";
import {
  SEARCH_TEXT_EXCERPTS_MAX,
  capExcerpts,
  type Scope,
} from "./args";
import type { CoreToolDeps, TextScanHit } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

/** Tool-local tunables (tools-deps forbids constants.ts). */
export const SEARCH_TEXT_BUDGET_MS = 2000;
export const SEARCH_TEXT_SLICE_MS = 10;
export const EXCERPT_EXPAND_MIN = 200;
export const EXCERPT_EXPAND_MAX = 600;

const TITLE_BOOST = 2.0;
const ALIAS_BOOST = 1.5;
const HEADING_BOOST = 1.25;
const PHRASE_BONUS = 1.5;
const TF_SAT_K = 1.5;

export interface SearchTextHit {
  ref: DocMeta["ref"];
  score: number;
  excerpts: Excerpt[];
}

export interface SearchTextResult {
  hits: SearchTextHit[];
}

function pathInFolder(path: VaultPath, folder: string): boolean {
  const f = folder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (f.length === 0) {
    return true;
  }
  return path === f || path.startsWith(`${f}/`);
}

export function docMatchesScope(doc: DocMeta, scope: Scope | undefined): boolean {
  if (scope === undefined) {
    return true;
  }
  if (scope.kinds !== undefined && scope.kinds.length > 0) {
    if (!scope.kinds.includes(doc.ref.kind)) {
      return false;
    }
  }
  if (scope.folders !== undefined && scope.folders.length > 0) {
    if (!scope.folders.some((f) => pathInFolder(doc.ref.path, f))) {
      return false;
    }
  }
  if (scope.tags !== undefined && scope.tags.length > 0) {
    const docTags = new Set(doc.tags.map((t) => t.toLowerCase()));
    if (!scope.tags.some((t) => docTags.has(t.replace(/^#/, "").toLowerCase()))) {
      return false;
    }
  }
  if (scope.modifiedAfter !== undefined && doc.mtime < scope.modifiedAfter) {
    return false;
  }
  if (scope.excludePaths !== undefined && scope.excludePaths.length > 0) {
    if (scope.excludePaths.includes(doc.ref.path)) {
      return false;
    }
  }
  return true;
}

function saturateTf(tf: number): number {
  return tf / (tf + TF_SAT_K);
}

function idf(df: number, nDocs: number): number {
  return Math.log((nDocs + 1) / (df + 1)) + 1;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0 || haystack.length < needle.length) {
    return 0;
  }
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) {
      break;
    }
    count++;
    from = at + 1;
  }
  return count;
}

function inHeading(original: string, start: number): boolean {
  let lineStart = start;
  while (lineStart > 0 && original[lineStart - 1] !== "\n") {
    lineStart--;
  }
  const lineEnd = original.indexOf("\n", lineStart);
  const line = original.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  return /^#{1,6}\s/.test(line);
}

function expandExcerptWindow(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const matchLen = Math.max(0, end - start);
  const target = Math.min(
    EXCERPT_EXPAND_MAX,
    Math.max(EXCERPT_EXPAND_MIN, matchLen + 80),
  );
  const pad = Math.max(0, Math.floor((target - matchLen) / 2));
  let s = Math.max(0, start - pad);
  let e = Math.min(text.length, end + pad);
  const before = text.lastIndexOf("\n\n", start);
  if (before >= 0 && start - before <= pad + 40) {
    s = before + 2;
  }
  const after = text.indexOf("\n\n", end);
  if (after >= 0 && after - end <= pad + 40) {
    e = after;
  }
  if (e - s > EXCERPT_EXPAND_MAX) {
    e = s + EXCERPT_EXPAND_MAX;
  }
  return { start: s, end: e };
}

function compareHits(
  a: { score: number; mtime: number; path: string },
  b: { score: number; mtime: number; path: string },
): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (b.mtime !== a.mtime) {
    return b.mtime - a.mtime;
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function createSearchTextHandler(deps: CoreToolDeps): ToolHandler<"search_text"> {
  return async (args, ctx): Promise<ToolOutcome<SearchTextResult>> => {
    const needles = [...args.terms, ...args.phrases].filter((t) => t.trim().length > 0);
    const sliceMs = Number.isFinite(deps.sliceMs) ? deps.sliceMs : SEARCH_TEXT_SLICE_MS;
    const budgetMs = Number.isFinite(deps.budgetMs) ? deps.budgetMs : SEARCH_TEXT_BUDGET_MS;

    const scan = await deps.scanText({
      terms: needles,
      clock: deps.clock,
      sliceMs,
      budgetMs,
      signal: ctx.signal,
    });

    const foldedTerms = args.terms.map((t) => foldCase(t)).filter((t) => t.length > 0);
    const foldedPhrases = args.phrases.map((t) => foldCase(t)).filter((t) => t.length > 0);

    const byPath = new Map<VaultPath, TextScanHit[]>();
    for (const hit of scan.hits) {
      const doc = deps.getDoc(hit.path);
      if (!doc || !docMatchesScope(doc, args.scope)) {
        continue;
      }
      const list = byPath.get(hit.path);
      if (list) {
        list.push(hit);
      } else {
        byPath.set(hit.path, [hit]);
      }
    }

    type Ranked = {
      path: VaultPath;
      doc: DocMeta;
      score: number;
      hits: TextScanHit[];
      text: string;
    };

    const candidates: Ranked[] = [];
    for (const [path, hits] of byPath) {
      const doc = deps.getDoc(path);
      if (!doc) {
        continue;
      }
      let text: string;
      try {
        text = await deps.readText(path);
      } catch {
        continue;
      }
      candidates.push({ path, doc, score: 0, hits, text });
    }

    const nDocs = Math.max(1, candidates.length);
    const df = new Map<string, number>();
    for (const term of foldedTerms) {
      let count = 0;
      for (const c of candidates) {
        if (foldCase(c.text).includes(term)) {
          count++;
        }
      }
      df.set(term, count);
    }

    for (const c of candidates) {
      const folded = foldCase(c.text);
      const titleFolded = foldCase(c.doc.title);
      const aliasFolded = c.doc.aliases.map((a) => foldCase(a));
      let score = 0;

      for (const term of foldedTerms) {
        const tf = countOccurrences(folded, term);
        if (tf === 0) {
          continue;
        }
        score += idf(df.get(term) ?? 0, nDocs) * saturateTf(tf);
        if (titleFolded.includes(term)) {
          score += TITLE_BOOST;
        }
        if (aliasFolded.some((a) => a.includes(term))) {
          score += ALIAS_BOOST;
        }
      }

      for (const phrase of foldedPhrases) {
        if (folded.includes(phrase)) {
          score += PHRASE_BONUS;
          break;
        }
      }

      if (c.hits.some((h) => inHeading(c.text, h.start))) {
        score += HEADING_BOOST;
      }

      c.score = score;
    }

    candidates.sort((a, b) =>
      compareHits(
        { score: a.score, mtime: a.doc.mtime, path: a.path },
        { score: b.score, mtime: b.doc.mtime, path: b.path },
      ),
    );

    const top = candidates.slice(0, args.limit);
    const outHits: SearchTextHit[] = [];

    for (const row of top) {
      const excerpts: Excerpt[] = [];
      const seen = new Set<string>();
      const ordered = [...row.hits].sort((a, b) => a.start - b.start);
      for (const hit of ordered) {
        if (excerpts.length >= SEARCH_TEXT_EXCERPTS_MAX) {
          break;
        }
        const win = expandExcerptWindow(row.text, hit.start, hit.end);
        const key = `${win.start}:${win.end}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const excerptText = row.text.slice(win.start, win.end);
        const textHash = await sha1Hex(excerptText);
        excerpts.push({
          ref: row.doc.ref,
          locator: { start: win.start, end: win.end },
          text: excerptText,
          textHash,
          sourceMtime: row.doc.mtime,
        });
      }

      outHits.push({
        ref: row.doc.ref,
        score: row.score,
        excerpts: capExcerpts(excerpts, SEARCH_TEXT_EXCERPTS_MAX),
      });
    }

    return { ok: true, data: { hits: outHits }, truncated: scan.truncated };
  };
}
