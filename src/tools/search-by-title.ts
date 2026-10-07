/**
 * search_by_title tool (DESIGN §5.4) — title / alias / filename substring match.
 */

import { foldCase, type DocMeta, type VaultPath } from "../core";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

export type SearchByTitleMatchedOn = "title" | "alias" | "filename";

export interface SearchByTitleHit {
  ref: DocMeta["ref"];
  title: string;
  matchedOn: SearchByTitleMatchedOn;
}

export interface SearchByTitleResult {
  hits: SearchByTitleHit[];
}

const MATCH_RANK: Record<SearchByTitleMatchedOn, number> = {
  title: 0,
  alias: 1,
  filename: 2,
};

function filenameStem(path: VaultPath): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function createSearchByTitleHandler(
  deps: CoreToolDeps,
): ToolHandler<"search_by_title"> {
  return async (args): Promise<ToolOutcome<SearchByTitleResult>> => {
    const q = foldCase(args.query.trim());
    const best = new Map<
      VaultPath,
      { matchedOn: SearchByTitleMatchedOn; doc: DocMeta }
    >();

    for (const hit of deps.searchTitles(args.query)) {
      const doc = deps.getDoc(hit.path);
      if (!doc) {
        continue;
      }
      const prev = best.get(hit.path);
      if (!prev || MATCH_RANK[hit.matchedOn] < MATCH_RANK[prev.matchedOn]) {
        best.set(hit.path, { matchedOn: hit.matchedOn, doc });
      }
    }

    // Filename matches when title/alias did not already claim the path.
    for (const doc of deps.listDocs()) {
      if (best.has(doc.ref.path)) {
        continue;
      }
      const stem = foldCase(filenameStem(doc.ref.path));
      if (stem.includes(q)) {
        best.set(doc.ref.path, { matchedOn: "filename", doc });
      }
    }

    const hits: SearchByTitleHit[] = [...best.values()]
      .map(({ matchedOn, doc }) => ({
        ref: doc.ref,
        title: doc.title,
        matchedOn,
      }))
      .sort((a, b) => {
        const rank = MATCH_RANK[a.matchedOn] - MATCH_RANK[b.matchedOn];
        if (rank !== 0) {
          return rank;
        }
        return a.ref.path < b.ref.path ? -1 : a.ref.path > b.ref.path ? 1 : 0;
      })
      .slice(0, args.limit);

    return { ok: true, data: { hits }, truncated: false };
  };
}
