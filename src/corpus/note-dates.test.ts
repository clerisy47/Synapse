/**
 * TagIndex, TitleIndex, and NoteDateResolver (M2-T05 / DESIGN §4.2 / F-16).
 */

import { describe, expect, it } from "vitest";
import { asVaultPath } from "../core";
import { createNoteDateResolver, parseFrontmatterDate, resolveNoteDate } from "./note-dates";
import { createTagIndex } from "./tag-index";
import { createTitleIndex } from "./title-index";

const A = asVaultPath("notes/a.md");
const B = asVaultPath("notes/b.md");
const C = asVaultPath("notes/c.md");

describe("TagIndex", () => {
  it("indexes tags and returns exact matches when nested is false", () => {
    const idx = createTagIndex();
    idx.upsert(A, ["project", "project/alpha"]);
    idx.upsert(B, ["project/alpha"]);
    idx.upsert(C, ["inbox"]);

    expect(idx.pathsForTag("project", { nested: false })).toEqual([A]);
    expect(idx.pathsForTag("project/alpha", { nested: false })).toEqual([A, B]);
    expect(idx.pathsForTag("inbox", { nested: false })).toEqual([C]);
  });

  it("expands nested tags at query time by default", () => {
    const idx = createTagIndex();
    idx.upsert(A, ["project/alpha"]);
    idx.upsert(B, ["project/beta/deep"]);
    idx.upsert(C, ["projectish"]);

    expect(idx.pathsForTag("project")).toEqual([A, B]);
    expect(idx.pathsForTag("project/beta")).toEqual([B]);
    // Prefix without slash boundary must not match.
    expect(idx.pathsForTag("project").includes(C)).toBe(false);
    expect(idx.pathsForTag("projectish")).toEqual([C]);
  });

  it("replaces tags on upsert and clears on remove", () => {
    const idx = createTagIndex();
    idx.upsert(A, ["old", "keep"]);
    idx.upsert(A, ["new"]);
    expect(idx.pathsForTag("old")).toEqual([]);
    expect(idx.pathsForTag("keep")).toEqual([]);
    expect(idx.pathsForTag("new")).toEqual([A]);
    expect(idx.tags()).toEqual(["new"]);

    idx.remove(A);
    expect(idx.pathsForTag("new")).toEqual([]);
    expect(idx.tags()).toEqual([]);
  });

  it("dedupes tags and ignores empty strings", () => {
    const idx = createTagIndex();
    idx.upsert(A, ["x", "x", "", "y"]);
    expect(idx.tags()).toEqual(["x", "y"]);
    expect(idx.pathsForTag("x")).toEqual([A]);
  });

  it("clear removes all entries", () => {
    const idx = createTagIndex();
    idx.upsert(A, ["t"]);
    idx.clear();
    expect(idx.tags()).toEqual([]);
    expect(idx.pathsForTag("t")).toEqual([]);
  });
});

describe("TitleIndex", () => {
  it("matches folded title substrings", () => {
    const idx = createTitleIndex();
    idx.upsert(A, "My Project Notes", []);
    idx.upsert(B, "Other", []);

    expect(idx.search("project")).toEqual([{ path: A, matchedOn: "title" }]);
    expect(idx.search("PROJECT")).toEqual([{ path: A, matchedOn: "title" }]);
  });

  it("matches aliases when title does not", () => {
    const idx = createTitleIndex();
    idx.upsert(A, "filename", ["Research Brief", "RB"]);
    expect(idx.search("brief")).toEqual([{ path: A, matchedOn: "alias" }]);
    expect(idx.search("rb")).toEqual([{ path: A, matchedOn: "alias" }]);
  });

  it("prefers title over alias when both match", () => {
    const idx = createTitleIndex();
    idx.upsert(A, "Alpha Plan", ["Alpha Outline"]);
    expect(idx.search("alpha")).toEqual([{ path: A, matchedOn: "title" }]);
  });

  it("replaces on upsert and removes cleanly", () => {
    const idx = createTitleIndex();
    idx.upsert(A, "Old", ["alias"]);
    idx.upsert(A, "New Title", []);
    expect(idx.get(A)?.titleFolded).toBe("new title");
    expect(idx.search("alias")).toEqual([]);
    expect(idx.search("new")).toEqual([{ path: A, matchedOn: "title" }]);

    idx.remove(A);
    expect(idx.get(A)).toBeNull();
    expect(idx.search("new")).toEqual([]);
  });

  it("returns empty for empty query", () => {
    const idx = createTitleIndex();
    idx.upsert(A, "Hello", []);
    expect(idx.search("")).toEqual([]);
    expect(idx.search("   ")).toEqual([]);
  });
});

describe("NoteDateResolver", () => {
  it("parseFrontmatterDate accepts ISO date, datetime, and epoch ms", () => {
    expect(parseFrontmatterDate("2020-01-15")).toBe(Date.UTC(2020, 0, 15));
    expect(parseFrontmatterDate("2020-01-15T12:00:00Z")).toBe(
      Date.parse("2020-01-15T12:00:00Z"),
    );
    expect(parseFrontmatterDate(1_600_000_000_000)).toBe(1_600_000_000_000);
  });

  it("parseFrontmatterDate rejects invalid values", () => {
    expect(parseFrontmatterDate(null)).toBeNull();
    expect(parseFrontmatterDate(undefined)).toBeNull();
    expect(parseFrontmatterDate("")).toBeNull();
    expect(parseFrontmatterDate("not-a-date")).toBeNull();
    expect(parseFrontmatterDate("2020-13-40")).toBeNull();
    expect(parseFrontmatterDate(Number.NaN)).toBeNull();
    expect(parseFrontmatterDate({})).toBeNull();
  });

  it("mtime mode returns mtime", () => {
    expect(
      resolveNoteDate({
        mtime: 100,
        frontmatter: { created: "2020-01-01" },
        mode: "mtime",
      }),
    ).toBe(100);
  });

  it("field mode parses frontmatter date case-insensitively", () => {
    expect(
      resolveNoteDate({
        mtime: 100,
        frontmatter: { Created: "2020-06-01" },
        mode: { field: "created" },
      }),
    ).toBe(Date.UTC(2020, 5, 1));
  });

  it("field mode returns null when missing or invalid", () => {
    expect(
      resolveNoteDate({
        mtime: 100,
        frontmatter: {},
        mode: { field: "created" },
      }),
    ).toBeNull();
    expect(
      resolveNoteDate({
        mtime: 100,
        frontmatter: { created: "nope" },
        mode: { field: "created" },
      }),
    ).toBeNull();
    expect(
      resolveNoteDate({
        mtime: 100,
        frontmatter: { created: "2020-01-01" },
        mode: { field: "" },
      }),
    ).toBeNull();
  });

  it("createNoteDateResolver returns resolveNoteDate", () => {
    const resolve = createNoteDateResolver();
    expect(
      resolve({ mtime: 42, frontmatter: {}, mode: "mtime" }),
    ).toBe(42);
  });
});
