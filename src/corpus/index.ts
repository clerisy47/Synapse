/**
 * corpus — DocTable, warm loop, exclusion at ingest (DESIGN §3 / §4.2).
 */

export type { CorpusReader, CorpusStatus } from "./reader";
export { createCorpusReader, emptyCorpusStatus } from "./reader";

export type { SessionTracker } from "./session";
export { createSessionTracker } from "./session";

export type {
  CorpusIndexes,
  CorpusStore,
  CreateCorpusStoreOptions,
} from "./store";
export { createCorpusStore } from "./store";

export type {
  TextIndex,
  TextIndexEntry,
  TextScanHit,
  TextScanOptions,
  TextScanResult,
} from "./text-index";
export { createTextIndex, cutSnippet } from "./text-index";

export type { LinkGraph } from "./link-graph";
export { createLinkGraph } from "./link-graph";

export type { TagIndex, TagQueryOptions } from "./tag-index";
export { createTagIndex } from "./tag-index";

export type {
  TitleIndex,
  TitleIndexEntry,
  TitleMatchOn,
  TitleSearchHit,
} from "./title-index";
export { createTitleIndex } from "./title-index";

export type {
  NoteDateMode,
  NoteDateResolver,
  ResolveNoteDateInput,
} from "./note-dates";
export {
  createNoteDateResolver,
  parseFrontmatterDate,
  resolveNoteDate,
} from "./note-dates";
