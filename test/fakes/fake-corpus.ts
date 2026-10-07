/**
 * In-memory corpus for tool tests (DESIGN §5.4 / §9).
 * Seeds only allowed notes — omitted paths act as excluded/missing.
 */

import {
  asVaultPath,
  createObservable,
  type Clock,
  type DocMeta,
  type VaultPath,
} from "../../src/core";
import {
  createCorpusReader,
  createLinkGraph,
  createTagIndex,
  createTextIndex,
  createTitleIndex,
  emptyCorpusStatus,
  type LinkGraph,
  type TagIndex,
  type TextIndex,
  type TitleIndex,
} from "../../src/corpus";
import type { CoreToolDeps } from "../../src/tools";
import { FakeClock } from "./fake-clock";
import { FakeVault } from "./fake-vault";

export interface FakeCorpusNoteSeed {
  path: string;
  text: string;
  title?: string;
  aliases?: string[];
  tags?: string[];
  mtime?: number;
  ctime?: number;
}

export interface FakeCorpusPdfSeed {
  path: string;
  title?: string;
  mtime?: number;
  ctime?: number;
}

export interface FakeCorpusOptions {
  clock?: Clock;
  sliceMs?: number;
  budgetMs?: number;
  /** source → target → count (MetadataPort.resolvedLinks shape). */
  resolvedLinks?: Record<string, Record<string, number>>;
}

function folderOf(path: VaultPath): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function defaultTitle(path: VaultPath): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  if (base.toLowerCase().endsWith(".md")) {
    return base.slice(0, -3);
  }
  if (base.toLowerCase().endsWith(".pdf")) {
    return base.slice(0, -4);
  }
  return base;
}

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

export class FakeCorpus {
  readonly vault = new FakeVault();
  readonly textIndex: TextIndex = createTextIndex();
  readonly titleIndex: TitleIndex = createTitleIndex();
  readonly tagIndex: TagIndex = createTagIndex();
  readonly linkGraph: LinkGraph = createLinkGraph();
  readonly docs = new Map<VaultPath, DocMeta>();
  readonly clock: Clock;
  sliceMs: number;
  budgetMs: number;
  private nextMtime = 1_700_000_000_000;
  private readonly unresolvedBySource = new Map<VaultPath, number>();

  constructor(notes: readonly FakeCorpusNoteSeed[] = [], opts: FakeCorpusOptions = {}) {
    this.clock = opts.clock ?? new FakeClock();
    this.sliceMs = opts.sliceMs ?? 10;
    this.budgetMs = opts.budgetMs ?? 2000;

    for (const seed of notes) {
      this.addNote(seed);
    }
    if (opts.resolvedLinks) {
      this.setResolvedLinks(opts.resolvedLinks);
    }
  }

  addNote(seed: FakeCorpusNoteSeed): VaultPath {
    const mtime = seed.mtime ?? this.nextMtime++;
    const ctime = seed.ctime ?? mtime;
    const path = this.vault.addNote({
      path: seed.path,
      text: seed.text,
      mtime,
      ctime,
    });
    const title = seed.title ?? defaultTitle(path);
    const aliases = seed.aliases ?? [];
    const tags = (seed.tags ?? []).map((t) => t.replace(/^#/, "").toLowerCase());
    const meta: DocMeta = {
      ref: { path, kind: "note" },
      title,
      aliases: [...aliases],
      tags,
      folder: folderOf(path),
      mtime,
      ctime,
      size: new TextEncoder().encode(seed.text).byteLength,
    };
    this.docs.set(path, meta);
    this.textIndex.upsert(path, seed.text);
    this.titleIndex.upsert(path, title, aliases);
    this.tagIndex.upsert(path, tags);
    return path;
  }

  addPdf(seed: FakeCorpusPdfSeed): VaultPath {
    const mtime = seed.mtime ?? this.nextMtime++;
    const ctime = seed.ctime ?? mtime;
    const path = this.vault.addPdf({
      path: seed.path,
      mtime,
      ctime,
    });
    const title = seed.title ?? defaultTitle(path);
    const meta: DocMeta = {
      ref: { path, kind: "pdf" },
      title,
      aliases: [],
      tags: [],
      folder: folderOf(path),
      mtime,
      ctime,
      size: 0,
      pdf: { pageCount: 1, status: "pending", emptyPages: [] },
    };
    this.docs.set(path, meta);
    this.titleIndex.upsert(path, title, []);
    return path;
  }

  /**
   * Rebuild link graph from resolvedLinks; excluded/missing targets become unresolved.
   */
  setResolvedLinks(resolvedLinks: Record<string, Record<string, number>>): void {
    const allowed = new Set<string>([...this.docs.keys()]);
    this.linkGraph.rebuild(resolvedLinks, allowed);
    this.unresolvedBySource.clear();
    for (const [rawSource, targets] of Object.entries(resolvedLinks)) {
      const source = normalizePath(rawSource);
      if (!allowed.has(source)) {
        continue;
      }
      let unresolved = 0;
      const seen = new Set<string>();
      for (const [rawTarget, count] of Object.entries(targets)) {
        if (count <= 0) {
          continue;
        }
        const target = normalizePath(rawTarget);
        if (seen.has(target)) {
          continue;
        }
        seen.add(target);
        if (!allowed.has(target)) {
          unresolved += 1;
        }
      }
      if (unresolved > 0) {
        this.unresolvedBySource.set(source, unresolved);
      }
    }
  }

  reader() {
    return createCorpusReader({
      docs: this.docs,
      status: createObservable(emptyCorpusStatus()),
    });
  }

  asDeps(): CoreToolDeps {
    const corpus = this;
    return {
      getDoc(path) {
        return corpus.docs.get(path) ?? null;
      },
      listDocs() {
        return [...corpus.docs.values()];
      },
      scanText(opts) {
        return corpus.textIndex.scan(opts);
      },
      searchTitles(query) {
        return corpus.titleIndex.search(query);
      },
      readText(path) {
        return corpus.vault.readText(path);
      },
      outgoing(path) {
        return corpus.linkGraph.outgoing(path);
      },
      incoming(path) {
        return corpus.linkGraph.incoming(path);
      },
      unresolvedCount(path) {
        return corpus.unresolvedBySource.get(normalizePath(path)) ?? 0;
      },
      pathsForTag(tag, opts) {
        return corpus.tagIndex.pathsForTag(tag, opts);
      },
      get clock() {
        return corpus.clock;
      },
      get sliceMs() {
        return corpus.sliceMs;
      },
      get budgetMs() {
        return corpus.budgetMs;
      },
    };
  }
}
