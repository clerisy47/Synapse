import { describe, expect, it } from "vitest";
import { asVaultPath } from "../core";
import { FakeCorpus, FakeClock } from "../../test/fakes";
import {
  createReadNoteHandler,
  createSearchByTitleHandler,
  createSearchTextHandler,
  createToolRegistry,
  type CoreToolDeps,
  type SearchByTitleResult,
  type SearchTextResult,
  type ReadNoteResult,
  type ToolRegistry,
} from "./index";

function abortSignal(): AbortSignal {
  return new AbortController().signal;
}

function registryFor(deps: CoreToolDeps): ToolRegistry {
  return createToolRegistry({
    handlers: {
      search_text: createSearchTextHandler(deps),
      search_by_title: createSearchByTitleHandler(deps),
      read_note: createReadNoteHandler(deps),
    },
  });
}

function fixtureCorpus(): FakeCorpus {
  return new FakeCorpus([
    {
      path: "notes/alpha.md",
      title: "Alpha Project",
      aliases: ["AP"],
      tags: ["work"],
      mtime: 100,
      text: "The quantum rendezvous happens in alpha.\n\nMore alpha detail here.",
    },
    {
      path: "notes/beta.md",
      title: "Beta Notes",
      tags: ["play"],
      mtime: 200,
      text: "# Heading with quantum\n\nBeta body without the other term.",
    },
    {
      path: "inbox/gamma-brief.md",
      title: "Unrelated",
      mtime: 50,
      text: "Nothing special in this note.",
    },
  ]);
}

describe("search_text (AC-M2.1)", () => {
  it("typical: returns ranked hits with excerpts", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_text",
      { terms: ["quantum"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as SearchTextResult;
    expect(data.hits.length).toBe(2);
    expect(data.hits.map((h) => h.ref.path)).toEqual([
      "notes/beta.md",
      "notes/alpha.md",
    ]);
    const top = data.hits[0];
    expect(top).toBeDefined();
    const excerpt = top?.excerpts[0];
    expect(excerpt).toBeDefined();
    expect(excerpt?.text.toLowerCase()).toContain("quantum");
    expect(excerpt?.textHash.length).toBe(40);
  });

  it("empty: no matching terms → empty hits", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_text",
      { terms: ["zzzz-missing"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchTextResult).hits).toEqual([]);
      expect(out.truncated).toBe(false);
    }
  });

  it("excluded: omitted path never appears in hits", async () => {
    const corpus = fixtureCorpus();
    // secret.md never seeded → treated as excluded/missing
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_text",
      { terms: ["classified"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const paths = (out.data as SearchTextResult).hits.map((h) => h.ref.path);
      expect(paths).not.toContain("secret.md");
      expect(paths).toEqual([]);
    }
  });

  it("honors scope.excludePaths", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_text",
      {
        terms: ["quantum"],
        scope: { excludePaths: [asVaultPath("notes/beta.md")] },
      },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchTextResult).hits.map((h) => h.ref.path)).toEqual([
        "notes/alpha.md",
      ]);
    }
  });

  it("marks truncated when scan budget is exhausted", async () => {
    const clock = new FakeClock(0);
    const corpus = new FakeCorpus(
      [
        { path: "a.md", text: "needle here", mtime: 1 },
        { path: "b.md", text: "needle there", mtime: 2 },
      ],
      { clock, budgetMs: 0, sliceMs: 10 },
    );
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_text",
      { terms: ["needle"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.truncated).toBe(true);
    }
  });
});

describe("search_by_title (AC-M2.1)", () => {
  it("typical: matches title and prefers title over alias", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_title",
      { query: "Alpha" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as SearchByTitleResult;
    expect(data.hits[0]).toMatchObject({
      ref: { path: "notes/alpha.md", kind: "note" },
      title: "Alpha Project",
      matchedOn: "title",
    });
  });

  it("typical: matches alias and filename", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const alias = await reg.invoke(
      "search_by_title",
      { query: "AP" },
      { signal: abortSignal() },
    );
    expect(alias.ok).toBe(true);
    if (alias.ok) {
      expect((alias.data as SearchByTitleResult).hits[0]?.matchedOn).toBe("alias");
    }

    const file = await reg.invoke(
      "search_by_title",
      { query: "gamma-brief" },
      { signal: abortSignal() },
    );
    expect(file.ok).toBe(true);
    if (file.ok) {
      const hit = (file.data as SearchByTitleResult).hits[0];
      expect(hit?.ref.path).toBe("inbox/gamma-brief.md");
      expect(hit?.matchedOn).toBe("filename");
    }
  });

  it("empty: no title matches", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_title",
      { query: "zzzz-missing" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchByTitleResult).hits).toEqual([]);
    }
  });

  it("excluded: omitted path never returned", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_title",
      { query: "secret" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchByTitleResult).hits).toEqual([]);
    }
  });
});

describe("read_note (AC-M2.1)", () => {
  it("typical: returns windowed excerpt", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "read_note",
      {
        path: "notes/alpha.md",
        window: { start: 0, maxChars: 20 },
      },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as ReadNoteResult;
    expect(data.excerpts).toHaveLength(1);
    const excerpt = data.excerpts[0];
    expect(excerpt?.text.length).toBe(20);
    expect(data.totalChars).toBeGreaterThan(20);
    expect(data.nextStart).toBe(20);
    expect(excerpt?.textHash.length).toBe(40);
  });

  it("empty: start past end → empty excerpts", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const full = await reg.invoke(
      "read_note",
      { path: "notes/alpha.md" },
      { signal: abortSignal() },
    );
    expect(full.ok).toBe(true);
    if (!full.ok) {
      return;
    }
    const total = (full.data as ReadNoteResult).totalChars;
    const out = await reg.invoke(
      "read_note",
      { path: "notes/alpha.md", window: { start: total, maxChars: 100 } },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as ReadNoteResult).excerpts).toEqual([]);
      expect((out.data as ReadNoteResult).totalChars).toBe(total);
    }
  });

  it("excluded / missing → NOT_FOUND (same shape)", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const missing = await reg.invoke(
      "read_note",
      { path: "missing.md" },
      { signal: abortSignal() },
    );
    const excluded = await reg.invoke(
      "read_note",
      { path: "secret/excluded.md" },
      { signal: abortSignal() },
    );
    expect(missing.ok).toBe(false);
    expect(excluded.ok).toBe(false);
    if (!missing.ok && !excluded.ok) {
      expect(missing.error.code).toBe("NOT_FOUND");
      expect(excluded.error.code).toBe("NOT_FOUND");
    }
  });
});
