/**
 * CorpusStore warm + exclusion-at-ingest (M2-T02).
 */

import { describe, expect, it } from "vitest";
import {
  asVaultPath,
  type Clock,
  type Disposable,
  type MetadataPort,
  type NoteMetadata,
  type VaultPath,
} from "../core";
import { createExclusionPolicy } from "../policy";
import { FakeClock, FakeMetadata, FakeVault } from "../../test/fakes";
import { createCorpusStore } from "./store";
import { createSessionTracker } from "./session";

const EXCLUDE_KEY = "vault-synapse";

/** Minimal MetadataPort for corpus tests (FakeMetadata lands in M2-T04). */
class TestMetadata implements MetadataPort {
  private readonly byPath = new Map<string, NoteMetadata | null>();
  private resolved = true;
  private readonly changed = new Set<(path: VaultPath) => void>();
  private readonly resolvedListeners = new Set<() => void>();

  set(path: string, meta: NoteMetadata | null): void {
    this.byPath.set(asVaultPath(path), meta);
  }

  setResolved(value: boolean): void {
    this.resolved = value;
  }

  emitChanged(path: string): void {
    const p = asVaultPath(path);
    for (const cb of [...this.changed]) {
      cb(p);
    }
  }

  emitResolved(): void {
    this.resolved = true;
    for (const cb of [...this.resolvedListeners]) {
      cb();
    }
  }

  isResolved(): boolean {
    return this.resolved;
  }

  get(path: VaultPath): NoteMetadata | null {
    if (!this.byPath.has(path)) {
      return null;
    }
    return this.byPath.get(path) ?? null;
  }

  resolvedLinks(): Record<string, Record<string, number>> {
    return {};
  }

  onChanged(cb: (path: VaultPath) => void): Disposable {
    this.changed.add(cb);
    return () => {
      this.changed.delete(cb);
    };
  }

  onResolved(cb: () => void): Disposable {
    this.resolvedListeners.add(cb);
    return () => {
      this.resolvedListeners.delete(cb);
    };
  }
}

function noteMeta(
  partial: Partial<NoteMetadata> & { tags?: string[] } = {},
): NoteMetadata {
  return {
    frontmatter: partial.frontmatter ?? {},
    tags: partial.tags ?? [],
    headings: partial.headings ?? [],
  };
}

/** Clock that advances mono on each consider-friendly tick and counts yields. */
class SliceSpyClock implements Clock {
  private wall = 0;
  private monoMs = 0;
  yields = 0;
  /** Advance mono by this much before each yield check after the first file. */
  advancePerFile = 0;

  now(): number {
    return this.wall;
  }

  mono(): number {
    return this.monoMs;
  }

  todayLocal(): string {
    return "2026-01-01";
  }

  async sleep(): Promise<void> {
    /* unused */
  }

  async yieldNow(): Promise<void> {
    this.yields++;
  }

  /** Call between files so warm sees elapsed >= sliceMs. */
  tickFile(): void {
    this.monoMs += this.advancePerFile;
    this.wall += this.advancePerFile;
  }
}

describe("SessionTracker", () => {
  it("records touches and filters by window", () => {
    const s = createSessionTracker();
    const a = asVaultPath("A.md");
    const b = asVaultPath("B.md");
    s.touch(a, 100);
    s.touch(b, 200);
    s.touch(a, 50); // older — ignored
    expect(s.lastTouched(a)).toBe(100);
    expect(s.touchedSince(150)).toEqual([b]);
    s.clear();
    expect(s.lastTouched(a)).toBeUndefined();
  });
});

describe("CorpusStore", () => {
  function setup(opts?: {
    folders?: string[];
    tags?: string[];
    sliceMs?: number;
    clock?: Clock;
  }) {
    const vault = new FakeVault();
    const metadata = new TestMetadata();
    const clock = opts?.clock ?? new FakeClock(1_000);
    const exclusion = createExclusionPolicy({
      folders: opts?.folders ?? [],
      tags: opts?.tags ?? [],
      frontmatterKey: EXCLUDE_KEY,
    });
    const store = createCorpusStore({
      vault,
      metadata,
      exclusion,
      clock,
      sliceMs: opts?.sliceMs ?? 10,
    });
    return { vault, metadata, clock, store };
  }

  it("indexes allowed notes with DocMeta fields", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({
      path: "Notes/Idea.md",
      text: "body",
      mtime: 10,
      ctime: 5,
    });
    metadata.set("Notes/Idea.md", {
      frontmatter: { aliases: ["Alt", "Other"] },
      tags: ["project"],
      headings: [],
    });

    await store.warm();
    const reader = store.reader();
    const doc = reader.get(asVaultPath("Notes/Idea.md"));
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Idea");
    expect(doc!.aliases).toEqual(["Alt", "Other"]);
    expect(doc!.tags).toEqual(["project"]);
    expect(doc!.folder).toBe("Notes");
    expect(doc!.mtime).toBe(10);
    expect(doc!.ctime).toBe(5);
    expect(doc!.ref.kind).toBe("note");
    expect(reader.status().phase).toBe("ready");
    expect(reader.status().indexedNotes).toBe(1);
    expect(reader.status().totalNotes).toBe(1);
    store.dispose();
  });

  it("excludes folder, tag, and frontmatter notes", async () => {
    const { vault, metadata, store } = setup({
      folders: ["Private"],
      tags: ["secret"],
    });
    vault.addNote({ path: "Private/a.md", text: "x" });
    vault.addNote({ path: "Open/b.md", text: "y" });
    vault.addNote({ path: "Open/c.md", text: "z" });
    metadata.set("Private/a.md", noteMeta());
    metadata.set("Open/b.md", noteMeta({ tags: ["secret"] }));
    metadata.set("Open/c.md", noteMeta({
      frontmatter: { [EXCLUDE_KEY]: "ignore" },
    }));

    await store.warm();
    const reader = store.reader();
    expect(reader.has(asVaultPath("Private/a.md"))).toBe(false);
    expect(reader.has(asVaultPath("Open/b.md"))).toBe(false);
    expect(reader.has(asVaultPath("Open/c.md"))).toBe(false);
    expect(reader.list()).toHaveLength(0);
    expect(reader.status().totalNotes).toBe(3);
    expect(reader.status().indexedNotes).toBe(0);
    store.dispose();
  });

  it("keeps unparsed metadata out until onChanged", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({ path: "Notes/late.md", text: "hi" });
    // no metadata yet

    await store.warm();
    const reader = store.reader();
    expect(reader.has(asVaultPath("Notes/late.md"))).toBe(false);
    expect(reader.status().phase).toBe("ready");

    metadata.set("Notes/late.md", noteMeta({ tags: ["ok"] }));
    metadata.emitChanged("Notes/late.md");
    // allow microtask for async consider
    await Promise.resolve();
    await Promise.resolve();

    expect(reader.has(asVaultPath("Notes/late.md"))).toBe(true);
    expect(reader.get(asVaultPath("Notes/late.md"))!.tags).toEqual(["ok"]);
    store.dispose();
  });

  it("PDF folder exclude vs allow-pending", async () => {
    const { vault, store } = setup({ folders: ["Secret"] });
    vault.addPdf({ path: "Secret/a.pdf" });
    vault.addPdf({ path: "Papers/b.pdf" });

    await store.warm();
    const reader = store.reader();
    expect(reader.has(asVaultPath("Secret/a.pdf"))).toBe(false);
    const pdf = reader.get(asVaultPath("Papers/b.pdf"));
    expect(pdf).not.toBeNull();
    expect(pdf!.ref.kind).toBe("pdf");
    expect(pdf!.pdf?.status).toBe("pending");
    expect(reader.status().pdfTotal).toBe(2);
    expect(reader.status().pdfIndexed).toBe(1);
    store.dispose();
  });

  it("publishes warming then ready", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({ path: "n.md", text: "t" });
    metadata.set("n.md", noteMeta());

    const phases: string[] = [];
    store.status.subscribe((s) => {
      phases.push(s.phase);
    });

    await store.warm();
    expect(phases[0]).toBe("warming");
    expect(phases[phases.length - 1]).toBe("ready");
    store.dispose();
  });

  it("yields when mono elapsed reaches sliceMs", async () => {
    const spy = new SliceSpyClock();
    spy.advancePerFile = 10;
    const { vault, metadata, store } = setup({
      clock: spy,
      sliceMs: 10,
    });

    // Interleave mono advancement: wrap consider by advancing before each
    // file via a custom vault list order and ticking in yieldNow... 
    // Instead: make mono() increase by advancePerFile each call after start.
    let monoCalls = 0;
    const startMono = spy.mono();
    const originalMono = spy.mono.bind(spy);
    spy.mono = (): number => {
      const v = originalMono();
      // After warm sets lastYield, each subsequent mono() for the check
      // should look elapsed. Simpler: bump on every mono read after first.
      monoCalls++;
      if (monoCalls > 1) {
        return startMono + (monoCalls - 1) * 10;
      }
      return v;
    };

    vault.addNote({ path: "a.md", text: "1" });
    vault.addNote({ path: "b.md", text: "2" });
    vault.addNote({ path: "c.md", text: "3" });
    metadata.set("a.md", noteMeta());
    metadata.set("b.md", noteMeta());
    metadata.set("c.md", noteMeta());

    await store.warm();
    expect(spy.yields).toBeGreaterThanOrEqual(1);
    store.dispose();
  });

  it("dispose stops further metadata updates", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({ path: "a.md", text: "1" });
    metadata.set("a.md", noteMeta());
    await store.warm();
    store.dispose();

    vault.addNote({ path: "b.md", text: "2" });
    metadata.set("b.md", noteMeta());
    metadata.emitChanged("b.md");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.reader().has(asVaultPath("b.md"))).toBe(false);
    expect(store.reader().list()).toHaveLength(0);
  });

  it("exposes session tracker on the store", () => {
    const { store } = setup();
    const path = asVaultPath("x.md");
    store.session().touch(path, 42);
    expect(store.session().lastTouched(path)).toBe(42);
    store.dispose();
  });

  it("maintains text/title/tag indexes for allowed notes", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({ path: "Notes/Idea.md", text: "hello Synapse body" });
    metadata.set("Notes/Idea.md", {
      frontmatter: { aliases: ["Alt"] },
      tags: ["project/x"],
      headings: [],
    });

    await store.warm();
    const idx = store.indexes();
    const path = asVaultPath("Notes/Idea.md");
    expect(idx.text.has(path)).toBe(true);
    expect(idx.title.search("Idea").map((h) => h.path)).toContain(path);
    expect(idx.tag.pathsForTag("project")).toContain(path);
    expect(store.getFrontmatter(path)).toEqual({ aliases: ["Alt"] });
    expect(store.reader().status().bytesCached).toBeGreaterThan(0);
    store.dispose();
  });

  it("rebuilds link graph with unresolved excluded targets", async () => {
    const vault = new FakeVault();
    const metadata = new FakeMetadata();
    const clock = new FakeClock(1_000);
    const exclusion = createExclusionPolicy({
      folders: ["Private"],
      tags: [],
      frontmatterKey: EXCLUDE_KEY,
    });
    const store = createCorpusStore({
      vault,
      metadata,
      exclusion,
      clock,
      sliceMs: 10,
    });
    vault.addNote({ path: "Open/a.md", text: "link" });
    vault.addNote({ path: "Private/secret.md", text: "hidden" });
    metadata.set("Open/a.md", noteMeta());
    metadata.set("Private/secret.md", noteMeta());
    metadata.setResolvedLinks({
      "Open/a.md": { "Open/a.md": 1, "Private/secret.md": 1, "Missing.md": 1 },
    });

    await store.warm();
    const a = asVaultPath("Open/a.md");
    expect(store.reader().has(a)).toBe(true);
    expect(store.reader().has(asVaultPath("Private/secret.md"))).toBe(false);
    expect(store.indexes().links.outgoing(a)).toEqual([a]);
    expect(store.unresolvedCount(a)).toBe(2);
    store.dispose();
  });

  it("drops secondary indexes when a note is excluded later", async () => {
    const { vault, metadata, store } = setup();
    vault.addNote({ path: "n.md", text: "body" });
    metadata.set("n.md", noteMeta({ tags: ["ok"] }));
    await store.warm();
    const path = asVaultPath("n.md");
    expect(store.indexes().text.has(path)).toBe(true);

    metadata.set("n.md", noteMeta({
      frontmatter: { [EXCLUDE_KEY]: "ignore" },
    }));
    metadata.emitChanged("n.md");
    await Promise.resolve();
    await Promise.resolve();

    expect(store.reader().has(path)).toBe(false);
    expect(store.indexes().text.has(path)).toBe(false);
    expect(store.getFrontmatter(path)).toBeNull();
    store.dispose();
  });
});
