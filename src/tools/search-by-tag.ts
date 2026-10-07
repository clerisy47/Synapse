/**
 * search_by_tag tool (DESIGN §5.4) — TagIndex nested expand + limit.
 */

import type { SourceRef } from "../core";
import type { SearchByTagArgs } from "./args";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

export interface SearchByTagResult {
  refs: SourceRef[];
}

export function createSearchByTagHandler(
  deps: CoreToolDeps,
): ToolHandler<"search_by_tag"> {
  return async (args: SearchByTagArgs): Promise<ToolOutcome<SearchByTagResult>> => {
    const tag = args.tag.replace(/^#/, "").toLowerCase();
    const paths = deps.pathsForTag(tag, { nested: args.nested });
    const refs: SourceRef[] = [];
    for (const path of paths) {
      if (refs.length >= args.limit) {
        break;
      }
      const doc = deps.getDoc(path);
      if (doc) {
        refs.push(doc.ref);
      }
    }
    return { ok: true, data: { refs }, truncated: false };
  };
}
