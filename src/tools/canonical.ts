/**
 * Canonical tool-call keys and duplicate detection (DESIGN §5.4, AC-M2.5).
 */

import {
  err,
  foldCase,
  ok,
  stableStringify,
  synapseError,
  type Result,
  type SynapseError,
  type VaultPath,
} from "../core";
import {
  GET_BACKLINKS_LIMIT_DEFAULT,
  LIST_RECENT_LIMIT_DEFAULT,
  READ_NOTE_PAGE_DEFAULT,
  SEARCH_BY_TAG_LIMIT_DEFAULT,
  SEARCH_BY_TAG_NESTED_DEFAULT,
  SEARCH_BY_TITLE_LIMIT_DEFAULT,
  SEARCH_TEXT_LIMIT_DEFAULT,
  parseToolArgs,
  type GetBacklinksArgs,
  type GetFrontmatterArgs,
  type GetLinksArgs,
  type ListRecentArgs,
  type ReadNoteArgs,
  type Scope,
  type SearchByTagArgs,
  type SearchByTitleArgs,
  type SearchTextArgs,
  type ToolArgsByName,
  type ToolName,
} from "./args";

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function foldTrim(s: string): string {
  return foldCase(s.trim());
}

function normalizeScope(scope: Scope | undefined): Scope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  const out: Scope = {};
  if (scope.folders !== undefined && scope.folders.length > 0) {
    out.folders = sortStrings(scope.folders.map(foldTrim));
  }
  if (scope.tags !== undefined && scope.tags.length > 0) {
    out.tags = sortStrings(scope.tags.map(foldTrim));
  }
  if (scope.kinds !== undefined && scope.kinds.length > 0) {
    out.kinds = [...scope.kinds].sort();
  }
  if (scope.modifiedAfter !== undefined) {
    out.modifiedAfter = scope.modifiedAfter;
  }
  if (scope.excludePaths !== undefined && scope.excludePaths.length > 0) {
    out.excludePaths = sortStrings(scope.excludePaths) as VaultPath[];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSearchText(args: SearchTextArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {
    terms: sortStrings(args.terms.map(foldTrim)),
  };
  if (args.phrases.length > 0) {
    out.phrases = sortStrings(args.phrases.map(foldTrim));
  }
  const scope = normalizeScope(args.scope);
  if (scope !== undefined) {
    out.scope = scope;
  }
  if (args.limit !== SEARCH_TEXT_LIMIT_DEFAULT) {
    out.limit = args.limit;
  }
  return out;
}

function normalizeSearchByTitle(args: SearchByTitleArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { query: foldTrim(args.query) };
  if (args.limit !== SEARCH_BY_TITLE_LIMIT_DEFAULT) {
    out.limit = args.limit;
  }
  return out;
}

function normalizeGetLinks(args: GetLinksArgs): Record<string, unknown> {
  return { paths: sortStrings(args.paths) };
}

function normalizeGetBacklinks(args: GetBacklinksArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { paths: sortStrings(args.paths) };
  if (args.limit !== GET_BACKLINKS_LIMIT_DEFAULT) {
    out.limit = args.limit;
  }
  return out;
}

function normalizeSearchByTag(args: SearchByTagArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { tag: foldTrim(args.tag) };
  if (args.nested !== SEARCH_BY_TAG_NESTED_DEFAULT) {
    out.nested = args.nested;
  }
  if (args.limit !== SEARCH_BY_TAG_LIMIT_DEFAULT) {
    out.limit = args.limit;
  }
  return out;
}

function normalizeGetFrontmatter(args: GetFrontmatterArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { paths: sortStrings(args.paths) };
  if (args.keys !== undefined && args.keys.length > 0) {
    out.keys = sortStrings(args.keys.map(foldTrim));
  }
  return out;
}

function normalizeListRecent(args: ListRecentArgs): Record<string, unknown> {
  const out: Record<string, unknown> = {
    by: args.by,
    days: args.days,
  };
  if (args.limit !== LIST_RECENT_LIMIT_DEFAULT) {
    out.limit = args.limit;
  }
  const scope = normalizeScope(args.scope);
  if (scope !== undefined) {
    out.scope = scope;
  }
  return out;
}

function normalizeReadNote(args: ReadNoteArgs): Record<string, unknown> {
  const out: Record<string, unknown> = { path: args.path };
  if (args.page !== READ_NOTE_PAGE_DEFAULT) {
    out.page = args.page;
  }
  if (args.window !== undefined) {
    out.window = { start: args.window.start, maxChars: args.window.maxChars };
  }
  return out;
}

export function normalizeArgsForKey<N extends ToolName>(
  name: N,
  args: ToolArgsByName[N],
): Record<string, unknown> {
  switch (name) {
    case "search_text":
      return normalizeSearchText(args as SearchTextArgs);
    case "search_by_title":
      return normalizeSearchByTitle(args as SearchByTitleArgs);
    case "get_links":
      return normalizeGetLinks(args as GetLinksArgs);
    case "get_backlinks":
      return normalizeGetBacklinks(args as GetBacklinksArgs);
    case "search_by_tag":
      return normalizeSearchByTag(args as SearchByTagArgs);
    case "get_frontmatter":
      return normalizeGetFrontmatter(args as GetFrontmatterArgs);
    case "list_recent":
      return normalizeListRecent(args as ListRecentArgs);
    case "read_note":
      return normalizeReadNote(args as ReadNoteArgs);
    default: {
      const _exhaustive: never = name;
      return { tool: String(_exhaustive) };
    }
  }
}

/**
 * Stable key for duplicate detection: tool name + normalized args.
 * Returns Result — invalid args yield TOOL_ARGS_INVALID (caller should not invent a key).
 */
export function canonicalKey(name: ToolName, rawArgs: unknown): Result<string> {
  const parsed = parseToolArgs(name, rawArgs);
  if (!parsed.ok) {
    return parsed;
  }
  const normalized = normalizeArgsForKey(name, parsed.value);
  return ok(`${name}:${stableStringify(normalized)}`);
}

export interface DuplicateTracker {
  /** Record a key; second identical key → TOOL_DUPLICATE_CALL. */
  check(key: string): Result<void>;
  has(key: string): boolean;
  clear(): void;
}

export function createDuplicateTracker(): DuplicateTracker {
  const seen = new Set<string>();
  return {
    check(key: string): Result<void> {
      if (seen.has(key)) {
        return err(
          synapseError({
            code: "TOOL_DUPLICATE_CALL",
            message: "duplicate tool call",
            remediation: "TOOL_DUPLICATE_CALL",
          }) satisfies SynapseError,
        );
      }
      seen.add(key);
      return ok(undefined);
    },
    has(key: string): boolean {
      return seen.has(key);
    },
    clear(): void {
      seen.clear();
    },
  };
}
