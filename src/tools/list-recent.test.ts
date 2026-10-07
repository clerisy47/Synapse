import { describe, expect, it } from "vitest";
import { asVaultPath } from "../core";
import { FakeClock, FakeCorpus } from "../../test/fakes";
import {
  createGetFrontmatterHandler,
  createListRecentHandler,
  createToolRegistry,
  type CoreToolDeps,
  type GetFrontmatterResult,
  type ListRecentResult,
  type ToolRegistry,
} from "./index";

const DAY = 86_400_000;
/** Fixed "now" so day windows are deterministic. */
const NOW = 1_700_000_000_000;

function abortSignal(): AbortSignal {
  return new AbortController().signal;
}

function registryFor(deps: CoreToolDeps): ToolRegistry {
  return createToolRegistry({
    handlers: {
      get_frontmatter: createGetFrontmatterHandler(deps),
      list_recent: createListRecentHandler(deps),
    },
  });
}

function fixtureCorpus(): FakeCorpus {
  const clock = new FakeClock(NOW);
  const corpus = new FakeCorpus(
    [
      {
        path: "notes/a.md",
        title: "A",
        text: "Note A",
        mtime: NOW - 2 * DAY,
        frontmatter: {
          status: "active",
          summary: "x".repeat(250),
          nested: { blurb: "y".repeat(210) },
          tags: ["keep"],
        },
      },
      {
        path: "notes/b.md",
        title: "B",
        text: "Note B",
        mtime: NOW - 10 * DAY,
        frontmatter: { status: "draft", count: 3 },
      },
      {
        path: "notes/empty-fm.md",
        title: "Empty FM",
        text: "No frontmatter keys",
        mtime: NOW - 1 * DAY,
      },
      {
        path: "archive/old.md",
        title: "Old",
        text: "Archived",
        mtime: NOW - 100 * DAY,
        frontmatter: { status: "archived" },
      },
    ],
    { clock },
  );
  corpus.addPdf({ path: "papers/x.pdf", title: "Paper X", mtime: NOW - 3 * DAY });
  corpus.touch("notes/a.md", NOW - 1 * DAY);
  corpus.touch("notes/b.md", NOW - 40 * DAY);
  return corpus;
}

describe("get_frontmatter (AC-M2.1)", () => {
  it("typical: returns clipped frontmatter for indexed notes", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_frontmatter",
      { paths: ["notes/a.md", "notes/b.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as GetFrontmatterResult;
    expect(data.results).toHaveLength(2);
    const a = data.results[0];
    expect(a?.path).toBe("notes/a.md");
    expect(a?.frontmatter.status).toBe("active");
    expect((a?.frontmatter.summary as string).length).toBe(200);
    expect(((a?.frontmatter.nested as { blurb: string }).blurb).length).toBe(200);
    expect(a?.frontmatter.tags).toEqual(["keep"]);
    expect(data.results[1]?.frontmatter).toEqual({ status: "draft", count: 3 });
  });

  it("typical: keys filter keeps only present keys", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_frontmatter",
      { paths: ["notes/a.md"], keys: ["status", "missing", "tags"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as GetFrontmatterResult;
    expect(data.results[0]?.frontmatter).toEqual({
      status: "active",
      tags: ["keep"],
    });
  });

  it("empty: note with no frontmatter and PDF return empty objects", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "get_frontmatter",
      { paths: ["notes/empty-fm.md", "papers/x.pdf"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as GetFrontmatterResult;
    expect(data.results[0]?.frontmatter).toEqual({});
    expect(data.results[1]?.frontmatter).toEqual({});
  });

  it("excluded/missing: same NOT_FOUND (does not leak existence)", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    for (const path of ["secret/excluded.md", "notes/missing.md"]) {
      const out = await reg.invoke(
        "get_frontmatter",
        { paths: [path] },
        { signal: abortSignal() },
      );
      expect(out.ok).toBe(false);
      if (out.ok) {
        return;
      }
      expect(out.error.code).toBe("NOT_FOUND");
    }
  });

  it("does not mutate stored frontmatter when clipping", async () => {
    const corpus = fixtureCorpus();
    const deps = corpus.asDeps();
    const path = asVaultPath("notes/a.md");
    const before = deps.getFrontmatter(path);
    expect((before?.summary as string).length).toBe(250);
    const reg = registryFor(deps);
    await reg.invoke(
      "get_frontmatter",
      { paths: ["notes/a.md"] },
      { signal: abortSignal() },
    );
    const after = deps.getFrontmatter(path);
    expect((after?.summary as string).length).toBe(250);
  });
});

describe("list_recent (AC-M2.1)", () => {
  it("typical: by mtime returns newest-first within days window", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 14, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as ListRecentResult;
    expect(data.items.map((i) => i.ref.path)).toEqual([
      "notes/empty-fm.md",
      "notes/a.md",
      "papers/x.pdf",
      "notes/b.md",
    ]);
    expect(data.items[0]?.lastTouched).toBe(NOW - 1 * DAY);
    expect(data.items.some((i) => i.ref.path === "archive/old.md")).toBe(false);
  });

  it("typical: by touched uses touch log, not mtime", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "touched", days: 7, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as ListRecentResult;
    expect(data.items.map((i) => i.ref.path)).toEqual(["notes/a.md"]);
    expect(data.items[0]?.lastTouched).toBe(NOW - 1 * DAY);
  });

  it("empty: by mtime when all docs are older than days", async () => {
    const clock = new FakeClock(NOW);
    const corpus = new FakeCorpus(
      [{ path: "notes/only.md", text: "x", mtime: NOW - 10 * DAY }],
      { clock },
    );
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 3, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect((out.data as ListRecentResult).items).toEqual([]);
  });

  it("empty: by touched with no touches in window", async () => {
    const clock = new FakeClock(NOW);
    const corpus = new FakeCorpus(
      [{ path: "notes/only.md", text: "x", mtime: NOW - 2 * DAY }],
      { clock },
    );
    // touch is old
    corpus.touch("notes/only.md", NOW - 30 * DAY);
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "touched", days: 7, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const data = out.data as ListRecentResult;
    expect(data.items).toEqual([]);
  });

  it("empty: never-touched notes omitted for by touched", async () => {
    const clock = new FakeClock(NOW);
    const corpus = new FakeCorpus(
      [{ path: "notes/only.md", text: "x", mtime: NOW }],
      { clock },
    );
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "touched", days: 7, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect((out.data as ListRecentResult).items).toEqual([]);
  });

  it("excluded notes never appear; missing path not applicable to list", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 3650, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    const paths = (out.data as ListRecentResult).items.map((i) => i.ref.path);
    expect(paths.some((p) => p.includes("excluded"))).toBe(false);
    expect(paths).not.toContain("secret/excluded.md");
  });

  it("scope filters folders", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 3650, limit: 20, scope: { folders: ["archive"] } },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect((out.data as ListRecentResult).items.map((i) => i.ref.path)).toEqual([
      "archive/old.md",
    ]);
  });

  it("limit caps results", async () => {
    const corpus = fixtureCorpus();
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 3650, limit: 2 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect((out.data as ListRecentResult).items).toHaveLength(2);
  });

  it("tie-break: equal lastTouched sorts by path ascending", async () => {
    const clock = new FakeClock(NOW);
    const corpus = new FakeCorpus(
      [
        { path: "notes/z.md", text: "z", mtime: NOW - DAY },
        { path: "notes/a.md", text: "a", mtime: NOW - DAY },
      ],
      { clock },
    );
    const reg = registryFor(corpus.asDeps());
    const out = await reg.invoke(
      "list_recent",
      { by: "mtime", days: 7, limit: 20 },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect((out.data as ListRecentResult).items.map((i) => i.ref.path)).toEqual([
      "notes/a.md",
      "notes/z.md",
    ]);
  });
});
