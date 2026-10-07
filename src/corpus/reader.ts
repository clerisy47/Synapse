/**
 * CorpusReader — read-only view over DocTable + status (DESIGN §3 / §4.2).
 */

import type { DocMeta, Observable, VaultPath } from "../core";

export interface CorpusStatus {
  phase: "warming" | "ready";
  indexedNotes: number;
  totalNotes: number;
  pdfIndexed: number;
  pdfTotal: number;
  bytesCached: number;
}

export interface CorpusReader {
  status(): CorpusStatus;
  /** Observable of the same status snapshot. */
  statusObservable(): Observable<CorpusStatus>;
  /** `null` when unknown or excluded (indistinguishable). */
  get(path: VaultPath): DocMeta | null;
  has(path: VaultPath): boolean;
  list(): readonly DocMeta[];
}

export interface CreateCorpusReaderOptions {
  docs: Map<VaultPath, DocMeta>;
  status: Observable<CorpusStatus>;
}

export function createCorpusReader(
  opts: CreateCorpusReaderOptions,
): CorpusReader {
  const { docs, status } = opts;

  return {
    status(): CorpusStatus {
      return status.get();
    },

    statusObservable(): Observable<CorpusStatus> {
      return status;
    },

    get(path): DocMeta | null {
      return docs.get(path) ?? null;
    },

    has(path): boolean {
      return docs.has(path);
    },

    list(): readonly DocMeta[] {
      return [...docs.values()];
    },
  };
}

export function emptyCorpusStatus(): CorpusStatus {
  return {
    phase: "warming",
    indexedNotes: 0,
    totalNotes: 0,
    pdfIndexed: 0,
    pdfTotal: 0,
    bytesCached: 0,
  };
}
