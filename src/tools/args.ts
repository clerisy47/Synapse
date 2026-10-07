/**
 * Tool arg validation and result caps (DESIGN §5.4).
 * Caps live here (tools-deps forbids importing constants.ts).
 */

import {
  asVaultPath,
  err,
  ok,
  synapseError,
  type Result,
  type SourceKind,
  type SynapseError,
  type VaultPath,
} from "../core";

// --- Arg / result caps (DESIGN §5.4 table) ---

export const SEARCH_TEXT_TERMS_MIN = 1;
export const SEARCH_TEXT_TERMS_MAX = 6;
export const SEARCH_TEXT_TERM_CHARS = 64;
export const SEARCH_TEXT_PHRASES_MAX = 3;
export const SEARCH_TEXT_PHRASE_CHARS = 80;
export const SEARCH_TEXT_LIMIT_MAX = 20;
export const SEARCH_TEXT_LIMIT_DEFAULT = 20;
export const SEARCH_TEXT_EXCERPTS_MAX = 2;

export const SEARCH_BY_TITLE_QUERY_CHARS = 80;
export const SEARCH_BY_TITLE_LIMIT_MAX = 20;
export const SEARCH_BY_TITLE_LIMIT_DEFAULT = 20;

export const PATHS_MAX = 5;

export const GET_BACKLINKS_LIMIT_MAX = 30;
export const GET_BACKLINKS_LIMIT_DEFAULT = 30;

export const SEARCH_BY_TAG_LIMIT_MAX = 30;
export const SEARCH_BY_TAG_LIMIT_DEFAULT = 30;
export const SEARCH_BY_TAG_NESTED_DEFAULT = true;

export const FRONTMATTER_STRING_CLIP = 200;

export const LIST_RECENT_DAYS_MAX = 3650;
export const LIST_RECENT_LIMIT_MAX = 20;
export const LIST_RECENT_LIMIT_DEFAULT = 20;

export const READ_NOTE_MAX_CHARS = 4000;
export const READ_NOTE_PAGE_DEFAULT = 1;

export const TOOL_NAMES = [
  "search_text",
  "search_by_title",
  "get_links",
  "get_backlinks",
  "search_by_tag",
  "get_frontmatter",
  "list_recent",
  "read_note",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

export interface Scope {
  folders?: string[];
  tags?: string[];
  kinds?: SourceKind[];
  modifiedAfter?: number;
  excludePaths?: VaultPath[];
}

export interface SearchTextArgs {
  terms: string[];
  phrases: string[];
  scope?: Scope;
  limit: number;
}

export interface SearchByTitleArgs {
  query: string;
  limit: number;
}

export interface GetLinksArgs {
  paths: VaultPath[];
}

export interface GetBacklinksArgs {
  paths: VaultPath[];
  limit: number;
}

export interface SearchByTagArgs {
  tag: string;
  nested: boolean;
  limit: number;
}

export interface GetFrontmatterArgs {
  paths: VaultPath[];
  keys?: string[];
}

export interface ListRecentArgs {
  by: "mtime" | "touched";
  days: number;
  limit: number;
  scope?: Scope;
}

export interface ReadNoteArgs {
  path: VaultPath;
  page: number;
  window?: { start: number; maxChars: number };
}

export type ToolArgsByName = {
  search_text: SearchTextArgs;
  search_by_title: SearchByTitleArgs;
  get_links: GetLinksArgs;
  get_backlinks: GetBacklinksArgs;
  search_by_tag: SearchByTagArgs;
  get_frontmatter: GetFrontmatterArgs;
  list_recent: ListRecentArgs;
  read_note: ReadNoteArgs;
};

function invalid(message: string, detail?: Record<string, string | number | boolean>): SynapseError {
  return synapseError({
    code: "TOOL_ARGS_INVALID",
    message,
    remediation: "TOOL_ARGS_INVALID",
    ...(detail !== undefined ? { detail } : {}),
  });
}

function asRecord(raw: unknown): Result<Record<string, unknown>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err(invalid("tool args must be an object"));
  }
  return ok(raw as Record<string, unknown>);
}

function parseStringList(
  value: unknown,
  field: string,
  opts: { min?: number; max: number; maxChars: number; allowEmpty?: boolean },
): Result<string[]> {
  if (value === undefined) {
    if ((opts.min ?? 0) > 0) {
      return err(invalid(`missing ${field}`));
    }
    return ok([]);
  }
  if (!Array.isArray(value)) {
    return err(invalid(`${field} must be an array`));
  }
  if (opts.min !== undefined && value.length < opts.min) {
    return err(invalid(`${field} length out of range`, { field, length: value.length }));
  }
  if (value.length > opts.max) {
    return err(invalid(`${field} length out of range`, { field, length: value.length }));
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return err(invalid(`${field} entries must be strings`));
    }
    const trimmed = item.trim();
    if (!opts.allowEmpty && trimmed.length === 0) {
      return err(invalid(`${field} entries must be non-empty`));
    }
    if (trimmed.length > opts.maxChars) {
      return err(invalid(`${field} entry too long`, { field, length: trimmed.length }));
    }
    out.push(trimmed);
  }
  return ok(out);
}

function parseLimit(
  value: unknown,
  max: number,
  defaultValue: number,
): Result<number> {
  if (value === undefined) {
    return ok(defaultValue);
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    return err(invalid("limit out of range", { max }));
  }
  return ok(value);
}

function parsePaths(value: unknown): Result<VaultPath[]> {
  if (!Array.isArray(value)) {
    return err(invalid("paths must be an array"));
  }
  if (value.length < 1 || value.length > PATHS_MAX) {
    return err(invalid("paths length out of range", { length: value.length }));
  }
  const out: VaultPath[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return err(invalid("paths entries must be non-empty strings"));
    }
    out.push(asVaultPath(item.trim()));
  }
  return ok(out);
}

function parseSourceKind(value: unknown): Result<SourceKind> {
  if (value === "note" || value === "pdf") {
    return ok(value);
  }
  return err(invalid("invalid source kind"));
}

function parseScope(value: unknown): Result<Scope | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return err(invalid("scope must be an object"));
  }
  const rec = value as Record<string, unknown>;
  const scope: Scope = {};

  if (rec.folders !== undefined) {
    if (!Array.isArray(rec.folders) || !rec.folders.every((f) => typeof f === "string")) {
      return err(invalid("scope.folders must be string[]"));
    }
    scope.folders = rec.folders.map((f) => f.trim()).filter((f) => f.length > 0);
  }

  if (rec.tags !== undefined) {
    if (!Array.isArray(rec.tags) || !rec.tags.every((t) => typeof t === "string")) {
      return err(invalid("scope.tags must be string[]"));
    }
    scope.tags = rec.tags.map((t) => t.trim()).filter((t) => t.length > 0);
  }

  if (rec.kinds !== undefined) {
    if (!Array.isArray(rec.kinds)) {
      return err(invalid("scope.kinds must be an array"));
    }
    const kinds: SourceKind[] = [];
    for (const k of rec.kinds) {
      const parsed = parseSourceKind(k);
      if (!parsed.ok) {
        return parsed;
      }
      kinds.push(parsed.value);
    }
    scope.kinds = kinds;
  }

  if (rec.modifiedAfter !== undefined) {
    if (typeof rec.modifiedAfter !== "number" || !Number.isFinite(rec.modifiedAfter)) {
      return err(invalid("scope.modifiedAfter must be a number"));
    }
    scope.modifiedAfter = rec.modifiedAfter;
  }

  if (rec.excludePaths !== undefined) {
    if (!Array.isArray(rec.excludePaths)) {
      return err(invalid("scope.excludePaths must be an array"));
    }
    const paths: VaultPath[] = [];
    for (const p of rec.excludePaths) {
      if (typeof p !== "string" || p.trim().length === 0) {
        return err(invalid("scope.excludePaths entries must be non-empty strings"));
      }
      paths.push(asVaultPath(p.trim()));
    }
    scope.excludePaths = paths;
  }

  return ok(scope);
}

function parseSearchText(rec: Record<string, unknown>): Result<SearchTextArgs> {
  const terms = parseStringList(rec.terms, "terms", {
    min: SEARCH_TEXT_TERMS_MIN,
    max: SEARCH_TEXT_TERMS_MAX,
    maxChars: SEARCH_TEXT_TERM_CHARS,
  });
  if (!terms.ok) {
    return terms;
  }
  const phrases = parseStringList(rec.phrases, "phrases", {
    max: SEARCH_TEXT_PHRASES_MAX,
    maxChars: SEARCH_TEXT_PHRASE_CHARS,
  });
  if (!phrases.ok) {
    return phrases;
  }
  const scope = parseScope(rec.scope);
  if (!scope.ok) {
    return scope;
  }
  const limit = parseLimit(rec.limit, SEARCH_TEXT_LIMIT_MAX, SEARCH_TEXT_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  const args: SearchTextArgs = {
    terms: terms.value,
    phrases: phrases.value,
    limit: limit.value,
  };
  if (scope.value !== undefined) {
    args.scope = scope.value;
  }
  return ok(args);
}

function parseSearchByTitle(rec: Record<string, unknown>): Result<SearchByTitleArgs> {
  if (typeof rec.query !== "string") {
    return err(invalid("missing query"));
  }
  const query = rec.query.trim();
  if (query.length === 0 || query.length > SEARCH_BY_TITLE_QUERY_CHARS) {
    return err(invalid("query length out of range", { length: query.length }));
  }
  const limit = parseLimit(rec.limit, SEARCH_BY_TITLE_LIMIT_MAX, SEARCH_BY_TITLE_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  return ok({ query, limit: limit.value });
}

function parseGetLinks(rec: Record<string, unknown>): Result<GetLinksArgs> {
  const paths = parsePaths(rec.paths);
  if (!paths.ok) {
    return paths;
  }
  return ok({ paths: paths.value });
}

function parseGetBacklinks(rec: Record<string, unknown>): Result<GetBacklinksArgs> {
  const paths = parsePaths(rec.paths);
  if (!paths.ok) {
    return paths;
  }
  const limit = parseLimit(rec.limit, GET_BACKLINKS_LIMIT_MAX, GET_BACKLINKS_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  return ok({ paths: paths.value, limit: limit.value });
}

function parseSearchByTag(rec: Record<string, unknown>): Result<SearchByTagArgs> {
  if (typeof rec.tag !== "string") {
    return err(invalid("missing tag"));
  }
  const tag = rec.tag.trim().replace(/^#/, "");
  if (tag.length === 0) {
    return err(invalid("tag must be non-empty"));
  }
  let nested = SEARCH_BY_TAG_NESTED_DEFAULT;
  if (rec.nested !== undefined) {
    if (typeof rec.nested !== "boolean") {
      return err(invalid("nested must be a boolean"));
    }
    nested = rec.nested;
  }
  const limit = parseLimit(rec.limit, SEARCH_BY_TAG_LIMIT_MAX, SEARCH_BY_TAG_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  return ok({ tag, nested, limit: limit.value });
}

function parseGetFrontmatter(rec: Record<string, unknown>): Result<GetFrontmatterArgs> {
  const paths = parsePaths(rec.paths);
  if (!paths.ok) {
    return paths;
  }
  const args: GetFrontmatterArgs = { paths: paths.value };
  if (rec.keys !== undefined) {
    const keys = parseStringList(rec.keys, "keys", {
      max: 64,
      maxChars: 128,
      allowEmpty: false,
    });
    if (!keys.ok) {
      return keys;
    }
    args.keys = keys.value;
  }
  return ok(args);
}

function parseListRecent(rec: Record<string, unknown>): Result<ListRecentArgs> {
  if (rec.by !== "mtime" && rec.by !== "touched") {
    return err(invalid("by must be mtime or touched"));
  }
  if (typeof rec.days !== "number" || !Number.isInteger(rec.days) || rec.days < 1 || rec.days > LIST_RECENT_DAYS_MAX) {
    return err(invalid("days out of range"));
  }
  const limit = parseLimit(rec.limit, LIST_RECENT_LIMIT_MAX, LIST_RECENT_LIMIT_DEFAULT);
  if (!limit.ok) {
    return limit;
  }
  const scope = parseScope(rec.scope);
  if (!scope.ok) {
    return scope;
  }
  const args: ListRecentArgs = {
    by: rec.by,
    days: rec.days,
    limit: limit.value,
  };
  if (scope.value !== undefined) {
    args.scope = scope.value;
  }
  return ok(args);
}

function parseReadNote(rec: Record<string, unknown>): Result<ReadNoteArgs> {
  if (typeof rec.path !== "string" || rec.path.trim().length === 0) {
    return err(invalid("missing path"));
  }
  const path = asVaultPath(rec.path.trim());
  let page = READ_NOTE_PAGE_DEFAULT;
  if (rec.page !== undefined) {
    if (typeof rec.page !== "number" || !Number.isInteger(rec.page) || rec.page < 1) {
      return err(invalid("page must be a positive integer"));
    }
    page = rec.page;
  }
  const args: ReadNoteArgs = { path, page };
  if (rec.window !== undefined) {
    if (rec.window === null || typeof rec.window !== "object" || Array.isArray(rec.window)) {
      return err(invalid("window must be an object"));
    }
    const win = rec.window as Record<string, unknown>;
    if (typeof win.start !== "number" || !Number.isInteger(win.start) || win.start < 0) {
      return err(invalid("window.start must be a non-negative integer"));
    }
    if (
      typeof win.maxChars !== "number" ||
      !Number.isInteger(win.maxChars) ||
      win.maxChars < 1 ||
      win.maxChars > READ_NOTE_MAX_CHARS
    ) {
      return err(invalid("window.maxChars out of range"));
    }
    args.window = { start: win.start, maxChars: win.maxChars };
  }
  return ok(args);
}

export function parseToolArgs<N extends ToolName>(
  name: N,
  raw: unknown,
): Result<ToolArgsByName[N]> {
  const rec = asRecord(raw);
  if (!rec.ok) {
    return rec;
  }
  switch (name) {
    case "search_text":
      return parseSearchText(rec.value) as Result<ToolArgsByName[N]>;
    case "search_by_title":
      return parseSearchByTitle(rec.value) as Result<ToolArgsByName[N]>;
    case "get_links":
      return parseGetLinks(rec.value) as Result<ToolArgsByName[N]>;
    case "get_backlinks":
      return parseGetBacklinks(rec.value) as Result<ToolArgsByName[N]>;
    case "search_by_tag":
      return parseSearchByTag(rec.value) as Result<ToolArgsByName[N]>;
    case "get_frontmatter":
      return parseGetFrontmatter(rec.value) as Result<ToolArgsByName[N]>;
    case "list_recent":
      return parseListRecent(rec.value) as Result<ToolArgsByName[N]>;
    case "read_note":
      return parseReadNote(rec.value) as Result<ToolArgsByName[N]>;
    default: {
      const _exhaustive: never = name;
      return err(invalid("unknown tool", { tool: String(_exhaustive) }));
    }
  }
}

/** Clamp a requested limit to `[1, max]`. */
export function clampLimit(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(Math.floor(value), max);
}

/** Clip frontmatter string values to DESIGN cap. */
export function clipFrontmatterString(value: string): string {
  return value.length <= FRONTMATTER_STRING_CLIP
    ? value
    : value.slice(0, FRONTMATTER_STRING_CLIP);
}

/** Clamp read_note window maxChars. */
export function clampMaxChars(value: number): number {
  return clampLimit(value, READ_NOTE_MAX_CHARS);
}

/** Cap excerpt arrays on search hits. */
export function capExcerpts<T>(excerpts: readonly T[], max = SEARCH_TEXT_EXCERPTS_MAX): T[] {
  return excerpts.slice(0, max);
}
