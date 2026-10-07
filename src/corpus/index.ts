/**
 * corpus — DocTable, warm loop, exclusion at ingest (DESIGN §3 / §4.2).
 */

export type { CorpusReader, CorpusStatus } from "./reader";
export { createCorpusReader, emptyCorpusStatus } from "./reader";

export type { SessionTracker } from "./session";
export { createSessionTracker } from "./session";

export type { CorpusStore, CreateCorpusStoreOptions } from "./store";
export { createCorpusStore } from "./store";
