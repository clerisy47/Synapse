/**
 * tools — arg validation, canonical keys, registry (DESIGN §5.4).
 * Tool bodies land in M2-T07–T09.
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
