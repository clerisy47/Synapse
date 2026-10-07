/**
 * In-memory corpus for tool tests (DESIGN §5.4 / §9).
 * Seeds only allowed notes — omitted paths act as excluded/missing.
 */

import {
  createObservable,
  type Clock,
  type DocMeta,
  type VaultPath,
} from "../../src/core";
import {
  createCorpusReader,
  createTextIndex,
  createTitleIndex,
  emptyCorpusStatus,
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

export interface FakeCorpusOptions {
  clock?: Clock;
  sliceMs?: number;
  budgetMs?: number;
}

function folderOf(path: VaultPath): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function defaultTitle(path: VaultPath): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export class FakeCorpus {
  readonly vault = new FakeVault();
  readonly textIndex: TextIndex = createTextIndex();
  readonly titleIndex: TitleIndex = createTitleIndex();
  readonly docs = new Map<VaultPath, DocMeta>();
  readonly clock: Clock;
  sliceMs: number;
  budgetMs: number;
  private nextMtime = 1_700_000_000_000;

  constructor(notes: readonly FakeCorpusNoteSeed[] = [], opts: FakeCorpusOptions = {}) {
    this.clock = opts.clock ?? new FakeClock();
    this.sliceMs = opts.sliceMs ?? 10;
    this.budgetMs = opts.budgetMs ?? 2000;

    for (const seed of notes) {
      this.addNote(seed);
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
    return path;
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
