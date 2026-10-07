import { describe, expect, it } from "vitest";
import { FakeCorpus } from "../../test/fakes";
import {
  createGetBacklinksHandler,
  createGetLinksHandler,
  createSearchByTagHandler,
  createToolRegistry,
  type CoreToolDeps,
  type GetBacklinksResult,
  type GetLinksResult,
  type SearchByTagResult,
  type ToolRegistry,
} from "./index";

function abortSignal(): AbortSignal {
  return new AbortController().signal;
}

function registryFor(deps: CoreToolDeps): ToolRegistry {
  return createToolRegistry({
    handlers: {
      get_links: createGetLinksHandler(deps),
      get_backlinks: createGetBacklinksHandler(deps),
      search_by_tag: createSearchByTagHandler(deps),
    },
  });
}

function fixtureCorpus(): FakeCorpus {
  const corpus = new FakeCorpus([
    {
      path: "notes/a.md",
      title: "A",
      tags: ["work", "work/deep"],
      text: "Note A links out.",
      mtime: 100,
    },
    {
      path: "notes/b.md",
      title: "B",
      tags: ["play"],
      text: "Note B.",
      mtime: 200,
    },
    {
      path: "notes/c.md",
      title: "C",
      tags: ["work/deep"],
      text: "Note C.",
      mtime: 150,
    },
    {
      path: "notes/lonely.md",
      title: "Lonely",
      tags: [],
      text: "No links.",
      mtime: 50,
    },
  ]);
  corpus.addPdf({ path: "papers/x.pdf", title: "Paper X", mtime: 300 });
  corpus.setResolvedLinks({
    "notes/a.md": {
      "notes/b.md": 1,
      "notes/c.md": 1,
      "secret/excluded.md": 1,
      "papers/x.pdf": 1,
    },
    "notes/b.md": {
      "notes/c.md": 2,
    },
    "notes/c.md": {},
  });
  return corpus;
}

describe("get_links (AC-M2.1 / AC-M2.7)", () => {
  it("typical: outgoing refs + unresolved excluded targets", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_links",
      { paths: ["notes/a.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as GetLinksResult;
    expect(data.results).toHaveLength(1);
    const row = data.results[0];
    expect(row?.path).toBe("notes/a.md");
    expect(row?.outgoing.map((r) => r.path)).toEqual([
      "notes/b.md",
      "notes/c.md",
      "papers/x.pdf",
    ]);
    expect(row?.outgoing.map((r) => r.kind)).toEqual(["note", "note", "pdf"]);
    expect(row?.unresolvedCount).toBe(1);
    expect(row?.outgoing.some((r) => r.path.includes("excluded"))).toBe(false);
  });

  it("empty: note with no outgoing links", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_links",
      { paths: ["notes/lonely.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as GetLinksResult;
      expect(data.results[0]?.outgoing).toEqual([]);
      expect(data.results[0]?.unresolvedCount).toBe(0);
    }
  });

  it("pdf: empty outgoing", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_links",
      { paths: ["papers/x.pdf"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const data = out.data as GetLinksResult;
      expect(data.results[0]?.outgoing).toEqual([]);
      expect(data.results[0]?.unresolvedCount).toBe(0);
    }
  });

  it("excluded / missing → NOT_FOUND (same shape)", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const missing = await reg.invoke(
      "get_links",
      { paths: ["missing.md"] },
      { signal: abortSignal() },
    );
    const excluded = await reg.invoke(
      "get_links",
      { paths: ["secret/excluded.md"] },
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

describe("get_backlinks (AC-M2.1 / AC-M2.7)", () => {
  it("typical: incoming refs (notes → pdf ok)", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_backlinks",
      { paths: ["notes/c.md", "papers/x.pdf"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as GetBacklinksResult;
    expect(data.results).toHaveLength(2);
    expect(data.results[0]?.incoming.map((r) => r.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
    expect(data.results[1]?.incoming.map((r) => r.path)).toEqual(["notes/a.md"]);
  });

  it("empty: no incoming links", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_backlinks",
      { paths: ["notes/a.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as GetBacklinksResult).results[0]?.incoming).toEqual([]);
    }
  });

  it("limit caps incoming", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_backlinks",
      { paths: ["notes/c.md"], limit: 1 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as GetBacklinksResult).results[0]?.incoming).toHaveLength(1);
      expect((out.data as GetBacklinksResult).results[0]?.incoming[0]?.path).toBe(
        "notes/a.md",
      );
    }
  });

  it("excluded / missing → NOT_FOUND", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_backlinks",
      { paths: ["secret/excluded.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("NOT_FOUND");
    }
  });
});

describe("search_by_tag (AC-M2.1 / AC-M2.7)", () => {
  it("typical: nested expand (default)", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_tag",
      { tag: "work" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as SearchByTagResult;
    expect(data.refs.map((r) => r.path)).toEqual([
      "notes/a.md",
      "notes/c.md",
    ]);
  });

  it("empty: unknown tag", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_tag",
      { tag: "zzzz-missing" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchByTagResult).refs).toEqual([]);
    }
  });

  it("nested false: exact tag only", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_tag",
      { tag: "work", nested: false },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.data as SearchByTagResult).refs.map((r) => r.path)).toEqual([
        "notes/a.md",
      ]);
    }
  });

  it("limit caps refs; excluded never appears", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "search_by_tag",
      { tag: "work", limit: 1 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      const refs = (out.data as SearchByTagResult).refs;
      expect(refs).toHaveLength(1);
      expect(refs[0]?.path).toBe("notes/a.md");
      expect(refs.some((r) => r.path.includes("excluded"))).toBe(false);
    }
  });
});
