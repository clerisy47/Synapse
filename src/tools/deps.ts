/**
 * Injected corpus seams for tool handlers (tools-deps forbids importing corpus).
 */

import type { Clock, DocMeta, VaultPath } from "../core";

export interface TextScanHit {
  path: VaultPath;
  start: number;
  end: number;
}

export interface TextScanRequest {
  terms: readonly string[];
  clock: Clock;
  sliceMs: number;
  budgetMs: number;
  signal?: AbortSignal;
}

export interface TextScanOutcome {
  hits: TextScanHit[];
  truncated: boolean;
}

export type TitleMatchedOn = "title" | "alias";

export interface TitleSearchHit {
  path: VaultPath;
  matchedOn: TitleMatchedOn;
}

/** Duck-typed ports wired by FakeCorpus / composition root. */
export interface CoreToolDeps {
  getDoc(path: VaultPath): DocMeta | null;
  listDocs(): readonly DocMeta[];
  scanText(opts: TextScanRequest): Promise<TextScanOutcome>;
  searchTitles(query: string): TitleSearchHit[];
  readText(path: VaultPath): Promise<string>;
  clock: Clock;
  sliceMs: number;
  budgetMs: number;
}
