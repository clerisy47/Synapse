/**
 * tools — arg validation, canonical keys, registry, core tool bodies (DESIGN §5.4).
 */

export type {
  GetBacklinksArgs,
  GetFrontmatterArgs,
  GetLinksArgs,
  ListRecentArgs,
  ReadNoteArgs,
  Scope,
  SearchByTagArgs,
  SearchByTitleArgs,
  SearchTextArgs,
  ToolArgsByName,
  ToolName,
} from "./args";
export {
  FRONTMATTER_STRING_CLIP,
  GET_BACKLINKS_LIMIT_DEFAULT,
  GET_BACKLINKS_LIMIT_MAX,
  LIST_RECENT_DAYS_MAX,
  LIST_RECENT_LIMIT_DEFAULT,
  LIST_RECENT_LIMIT_MAX,
  PATHS_MAX,
  READ_NOTE_MAX_CHARS,
  READ_NOTE_PAGE_DEFAULT,
  SEARCH_BY_TAG_LIMIT_DEFAULT,
  SEARCH_BY_TAG_LIMIT_MAX,
  SEARCH_BY_TAG_NESTED_DEFAULT,
  SEARCH_BY_TITLE_LIMIT_DEFAULT,
  SEARCH_BY_TITLE_LIMIT_MAX,
  SEARCH_BY_TITLE_QUERY_CHARS,
  SEARCH_TEXT_EXCERPTS_MAX,
  SEARCH_TEXT_LIMIT_DEFAULT,
  SEARCH_TEXT_LIMIT_MAX,
  SEARCH_TEXT_PHRASES_MAX,
  SEARCH_TEXT_PHRASE_CHARS,
  SEARCH_TEXT_TERM_CHARS,
  SEARCH_TEXT_TERMS_MAX,
  SEARCH_TEXT_TERMS_MIN,
  TOOL_NAMES,
  capExcerpts,
  clampLimit,
  clampMaxChars,
  clipFrontmatterString,
  isToolName,
  parseToolArgs,
} from "./args";

export type { DuplicateTracker } from "./canonical";
export {
  canonicalKey,
  createDuplicateTracker,
  normalizeArgsForKey,
} from "./canonical";

export type {
  CreateToolRegistryOptions,
  ToolHandler,
  ToolHandlers,
  ToolInvokeContext,
  ToolOutcome,
  ToolRegistry,
} from "./registry";
export { createToolRegistry } from "./registry";

export type {
  CoreToolDeps,
  TagPathsOptions,
  TextScanHit,
  TextScanOutcome,
  TextScanRequest,
  TitleMatchedOn,
  TitleSearchHit,
} from "./deps";

export type { SearchTextHit, SearchTextResult } from "./search-text";
export {
  EXCERPT_EXPAND_MAX,
  EXCERPT_EXPAND_MIN,
  SEARCH_TEXT_BUDGET_MS,
  SEARCH_TEXT_SLICE_MS,
  createSearchTextHandler,
  docMatchesScope,
} from "./search-text";

export type {
  SearchByTitleHit,
  SearchByTitleMatchedOn,
  SearchByTitleResult,
} from "./search-by-title";
export { createSearchByTitleHandler } from "./search-by-title";

export type { ReadNoteResult } from "./read-note";
export { createReadNoteHandler } from "./read-note";

export type {
  GetBacklinksPathResult,
  GetBacklinksResult,
  GetLinksPathResult,
  GetLinksResult,
} from "./links";
export { createGetBacklinksHandler, createGetLinksHandler } from "./links";

export type { SearchByTagResult } from "./search-by-tag";
export { createSearchByTagHandler } from "./search-by-tag";

export type {
  GetFrontmatterPathResult,
  GetFrontmatterResult,
} from "./frontmatter";
export { clipFrontmatterValue, createGetFrontmatterHandler } from "./frontmatter";

export type { ListRecentItem, ListRecentResult } from "./list-recent";
export { createListRecentHandler } from "./list-recent";
