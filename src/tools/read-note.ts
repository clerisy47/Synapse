/**
 * read_note tool (DESIGN §5.4) — windowed note body; PDF pages deferred to M4.
 */

import { sha1Hex, synapseError, type Excerpt } from "../core";
import { READ_NOTE_MAX_CHARS, type ReadNoteArgs } from "./args";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

export interface ReadNoteResult {
  excerpts: Excerpt[];
  totalChars: number;
  nextStart?: number;
  pageCount?: number;
}

export function createReadNoteHandler(deps: CoreToolDeps): ToolHandler<"read_note"> {
  return async (args: ReadNoteArgs): Promise<ToolOutcome<ReadNoteResult>> => {
    const doc = deps.getDoc(args.path);
    if (!doc) {
      return {
        ok: false,
        error: synapseError({
          code: "NOT_FOUND",
          message: "note not found",
          remediation: "NOT_FOUND",
        }),
      };
    }

    let text: string;
    try {
      text = await deps.readText(args.path);
    } catch {
      return {
        ok: false,
        error: synapseError({
          code: "NOT_FOUND",
          message: "note not found",
          remediation: "NOT_FOUND",
        }),
      };
    }

    const totalChars = text.length;
    const start = args.window?.start ?? 0;
    const maxChars = args.window?.maxChars ?? READ_NOTE_MAX_CHARS;
    if (start >= totalChars) {
      const empty: ReadNoteResult = { excerpts: [], totalChars };
      return { ok: true, data: empty, truncated: false };
    }

    const end = Math.min(totalChars, start + maxChars);
    const excerptText = text.slice(start, end);
    const textHash = await sha1Hex(excerptText);
    const excerpt: Excerpt = {
      ref: doc.ref,
      locator: { start, end },
      text: excerptText,
      textHash,
      sourceMtime: doc.mtime,
    };

    const data: ReadNoteResult = {
      excerpts: [excerpt],
      totalChars,
    };
    if (end < totalChars) {
      data.nextStart = end;
    }

    return { ok: true, data, truncated: false };
  };
}
