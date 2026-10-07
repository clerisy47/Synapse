/**
 * list_recent tool (DESIGN §5.4) — mtime or user-touch window over corpus docs.
 */

import type { SourceRef } from "../core";
import type { ListRecentArgs } from "./args";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";
import { docMatchesScope } from "./search-text";

const MS_PER_DAY = 86_400_000;

export interface ListRecentItem {
  ref: SourceRef;
  lastTouched: number;
}

export interface ListRecentResult {
  items: ListRecentItem[];
}

export function createListRecentHandler(
  deps: CoreToolDeps,
): ToolHandler<"list_recent"> {
  return async (args: ListRecentArgs): Promise<ToolOutcome<ListRecentResult>> => {
    const cutoff = deps.clock.now() - args.days * MS_PER_DAY;
    const items: ListRecentItem[] = [];

    for (const doc of deps.listDocs()) {
      if (!docMatchesScope(doc, args.scope)) {
        continue;
      }
      let lastTouched: number | undefined;
      if (args.by === "mtime") {
        lastTouched = doc.mtime;
      } else {
        lastTouched = deps.lastTouchedAt(doc.ref.path);
      }
      if (lastTouched === undefined || lastTouched < cutoff) {
        continue;
      }
      items.push({ ref: doc.ref, lastTouched });
    }

    items.sort((a, b) => {
      if (b.lastTouched !== a.lastTouched) {
        return b.lastTouched - a.lastTouched;
      }
      return a.ref.path < b.ref.path ? -1 : a.ref.path > b.ref.path ? 1 : 0;
    });

    return {
      ok: true,
      data: { items: items.slice(0, args.limit) },
      truncated: false,
    };
  };
}
