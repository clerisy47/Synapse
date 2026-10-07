/**
 * CorpusStore — DocTable + time-sliced warm + exclusion at ingest (DESIGN §4.2 / §6.6).
 */

import type {
  Clock,
  Disposable,
  DocMeta,
  FileStat,
  MetadataPort,
  NoteMetadata,
  Observable,
  VaultEvent,
  VaultPath,
  VaultPort,
} from "../core";
import { asVaultPath, createObservable } from "../core";
import type { ExclusionPolicy } from "../policy";
import {
  createCorpusReader,
  emptyCorpusStatus,
  type CorpusReader,
  type CorpusStatus,
} from "./reader";
import { createSessionTracker, type SessionTracker } from "./session";

export interface CreateCorpusStoreOptions {
  vault: VaultPort;
  metadata: MetadataPort;
  exclusion: ExclusionPolicy;
  clock: Clock;
  /** Yield interval (ms); composition passes SLICE_MS. */
  sliceMs: number;
}

export interface CorpusStore {
  readonly status: Observable<CorpusStatus>;
  reader(): CorpusReader;
  session(): SessionTracker;
  warm(signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

function basenameTitle(path: VaultPath): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function parentFolder(path: VaultPath): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function parseAliases(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.aliases ?? frontmatter.alias;
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? [t] : [];
  }
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t.length > 0) {
          out.push(t);
        }
      }
    }
    return out;
  }
  return [];
}

function docFromNote(stat: FileStat, meta: NoteMetadata): DocMeta {
  return {
    ref: { path: stat.path, kind: "note" },
    title: basenameTitle(stat.path),
    aliases: parseAliases(meta.frontmatter),
    tags: [...meta.tags],
    folder: parentFolder(stat.path),
    mtime: stat.mtime,
    ctime: stat.ctime,
    size: stat.size,
  };
}

function docFromPdf(stat: FileStat): DocMeta {
  return {
    ref: { path: stat.path, kind: "pdf" },
    title: basenameTitle(stat.path),
    aliases: [],
    tags: [],
    folder: parentFolder(stat.path),
    mtime: stat.mtime,
    ctime: stat.ctime,
    size: stat.size,
    pdf: { pageCount: 0, status: "pending", emptyPages: [] },
  };
}

function recount(
  docs: Map<VaultPath, DocMeta>,
  totals: { totalNotes: number; pdfTotal: number },
  phase: CorpusStatus["phase"],
): CorpusStatus {
  let indexedNotes = 0;
  let pdfIndexed = 0;
  for (const doc of docs.values()) {
    if (doc.ref.kind === "note") {
      indexedNotes++;
    } else {
      pdfIndexed++;
    }
  }
  return {
    phase,
    indexedNotes,
    totalNotes: totals.totalNotes,
    pdfIndexed,
    pdfTotal: totals.pdfTotal,
    bytesCached: 0,
  };
}

export function createCorpusStore(
  opts: CreateCorpusStoreOptions,
): CorpusStore {
  const { vault, metadata, exclusion, clock, sliceMs } = opts;
  const docs = new Map<VaultPath, DocMeta>();
  const session = createSessionTracker();
  const statusObs = createObservable(emptyCorpusStatus());
  const reader = createCorpusReader({ docs, status: statusObs });
  const disposables: Disposable[] = [];
  const totals = { totalNotes: 0, pdfTotal: 0 };

  let disposed = false;
  let warmAbort: AbortController | null = null;
  let phase: CorpusStatus["phase"] = "warming";

  function publish(): void {
    statusObs.set(recount(docs, totals, phase));
  }

  function removeDoc(path: VaultPath): void {
    if (docs.delete(path)) {
      publish();
    }
  }

  async function consider(path: VaultPath): Promise<void> {
    if (disposed) {
      return;
    }
    const key = asVaultPath(path);
    const stat = await vault.stat(key);
    if (!stat) {
      removeDoc(key);
      return;
    }

    if (stat.kind === "pdf") {
      const decision = exclusion.decide(key, null, null, { kind: "pdf" });
      if (decision === "excluded") {
        removeDoc(key);
        return;
      }
      docs.set(key, docFromPdf(stat));
      publish();
      return;
    }

    const meta = metadata.get(key);
    if (meta === null) {
      // Fail-closed until metadata is parsed (DESIGN §6.6).
      removeDoc(key);
      return;
    }

    const decision = exclusion.decide(key, meta.tags, meta.frontmatter, {
      kind: "note",
    });
    if (decision === "excluded") {
      removeDoc(key);
      return;
    }

    docs.set(key, docFromNote(stat, meta));
    publish();
  }

  function adjustTotalsForStat(stat: FileStat, delta: 1 | -1): void {
    if (stat.kind === "note") {
      totals.totalNotes = Math.max(0, totals.totalNotes + delta);
    } else {
      totals.pdfTotal = Math.max(0, totals.pdfTotal + delta);
    }
  }

  async function onVaultEvent(e: VaultEvent): Promise<void> {
    if (disposed) {
      return;
    }
    if (e.type === "delete") {
      const path = asVaultPath(e.path);
      const existing = docs.get(path);
      if (existing) {
        if (existing.ref.kind === "note") {
          totals.totalNotes = Math.max(0, totals.totalNotes - 1);
        } else {
          totals.pdfTotal = Math.max(0, totals.pdfTotal - 1);
        }
      } else {
        const lower = path.toLowerCase();
        if (lower.endsWith(".md")) {
          totals.totalNotes = Math.max(0, totals.totalNotes - 1);
        } else if (lower.endsWith(".pdf")) {
          totals.pdfTotal = Math.max(0, totals.pdfTotal - 1);
        }
      }
      removeDoc(path);
      publish();
      return;
    }

    if (e.type === "rename") {
      const from = asVaultPath(e.from);
      const to = asVaultPath(e.to);
      const was = docs.get(from);
      docs.delete(from);
      if (was) {
        // Totals unchanged if kind stays the same; re-consider `to`.
        if (
          (was.ref.kind === "note" && !to.toLowerCase().endsWith(".md")) ||
          (was.ref.kind === "pdf" && !to.toLowerCase().endsWith(".pdf"))
        ) {
          adjustTotalsForStat(
            {
              path: from,
              kind: was.ref.kind,
              mtime: was.mtime,
              ctime: was.ctime,
              size: was.size,
            },
            -1,
          );
          const toStat = await vault.stat(to);
          if (toStat) {
            adjustTotalsForStat(toStat, 1);
          }
        }
      }
      publish();
      await consider(to);
      return;
    }

    // create | modify
    const path = asVaultPath(e.path);
    if (e.type === "create") {
      const stat = await vault.stat(path);
      if (stat) {
        adjustTotalsForStat(stat, 1);
        publish();
      }
    }
    await consider(path);
  }

  disposables.push(
    vault.onChange((e) => {
      void onVaultEvent(e);
    }),
  );
  disposables.push(
    metadata.onChanged((path) => {
      void consider(asVaultPath(path));
    }),
  );
  disposables.push(
    metadata.onResolved(() => {
      void (async () => {
        if (disposed) {
          return;
        }
        const files = await vault.listFiles();
        for (const f of files) {
          if (disposed) {
            return;
          }
          await consider(f.path);
        }
      })();
    }),
  );

  return {
    status: statusObs,

    reader(): CorpusReader {
      return reader;
    },

    session(): SessionTracker {
      return session;
    },

    async warm(signal?: AbortSignal): Promise<void> {
      if (disposed) {
        return;
      }
      if (warmAbort) {
        warmAbort.abort();
      }
      const local = new AbortController();
      warmAbort = local;

      const isAborted = (): boolean =>
        disposed || local.signal.aborted || (signal?.aborted ?? false);

      let outerAbortListener: (() => void) | undefined;
      if (signal) {
        if (signal.aborted) {
          local.abort();
        } else {
          outerAbortListener = (): void => {
            local.abort();
          };
          signal.addEventListener("abort", outerAbortListener, { once: true });
        }
      }

      phase = "warming";
      publish();

      try {
        const files = await vault.listFiles();
        if (isAborted()) {
          return;
        }

        let noteTotal = 0;
        let pdfTotal = 0;
        for (const f of files) {
          if (f.kind === "note") {
            noteTotal++;
          } else {
            pdfTotal++;
          }
        }
        totals.totalNotes = noteTotal;
        totals.pdfTotal = pdfTotal;
        publish();

        let lastYield = clock.mono();
        for (const f of files) {
          if (isAborted()) {
            return;
          }
          const now = clock.mono();
          if (now - lastYield >= sliceMs) {
            await clock.yieldNow();
            lastYield = clock.mono();
          }
          await consider(f.path);
        }

        if (!isAborted()) {
          phase = "ready";
          publish();
        }
      } finally {
        if (outerAbortListener && signal) {
          signal.removeEventListener("abort", outerAbortListener);
        }
        if (warmAbort === local) {
          warmAbort = null;
        }
      }
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (warmAbort) {
        warmAbort.abort();
        warmAbort = null;
      }
      for (const d of disposables) {
        d();
      }
      disposables.length = 0;
      docs.clear();
      session.clear();
    },
  };
}
