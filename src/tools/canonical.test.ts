import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  createDuplicateTracker,
  createToolRegistry,
  parseToolArgs,
  clipFrontmatterString,
  clampMaxChars,
  capExcerpts,
} from "./index";

function abortSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("parseToolArgs", () => {
  it("rejects non-object args", () => {
    const r = parseToolArgs("search_text", "nope");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("rejects empty terms", () => {
    const r = parseToolArgs("search_text", { terms: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("rejects too many paths", () => {
    const r = parseToolArgs("get_links", {
      paths: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("rejects bad list_recent.by", () => {
    const r = parseToolArgs("list_recent", { by: "created", days: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("rejects overlong search_by_title query", () => {
    const r = parseToolArgs("search_by_title", { query: "x".repeat(81) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("accepts valid search_text and applies default limit", () => {
    const r = parseToolArgs("search_text", { terms: ["alpha"] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.terms).toEqual(["alpha"]);
      expect(r.value.phrases).toEqual([]);
      expect(r.value.limit).toBe(20);
    }
  });
});

describe("canonicalKey", () => {
  it("is order-insensitive for terms", () => {
    const a = canonicalKey("search_text", { terms: ["B", "a"] });
    const b = canonicalKey("search_text", { terms: ["a", "B"] });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
  });

  it("folds case and trims for equivalence", () => {
    const a = canonicalKey("search_text", { terms: ["  Foo "] });
    const b = canonicalKey("search_text", { terms: ["foo"] });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
  });

  it("drops default nested and limit for search_by_tag", () => {
    const withDefaults = canonicalKey("search_by_tag", {
      tag: "x",
      nested: true,
      limit: 30,
    });
    const minimal = canonicalKey("search_by_tag", { tag: "x" });
    expect(withDefaults.ok && minimal.ok).toBe(true);
    if (withDefaults.ok && minimal.ok) {
      expect(withDefaults.value).toBe(minimal.value);
      expect(withDefaults.value).toBe('search_by_tag:{"tag":"x"}');
    }
  });

  it("keeps non-default nested in the key", () => {
    const r = canonicalKey("search_by_tag", { tag: "x", nested: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain('"nested":false');
    }
  });

  it("sorts paths for get_links", () => {
    const a = canonicalKey("get_links", { paths: ["b.md", "a.md"] });
    const b = canonicalKey("get_links", { paths: ["a.md", "b.md"] });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
  });

  it("returns TOOL_ARGS_INVALID for bad args", () => {
    const r = canonicalKey("search_text", { terms: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("drops default page for read_note", () => {
    const a = canonicalKey("read_note", { path: "n.md", page: 1 });
    const b = canonicalKey("read_note", { path: "n.md" });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(b.value);
    }
  });
});

describe("createDuplicateTracker", () => {
  it("rejects a second identical key", () => {
    const tracker = createDuplicateTracker();
    const key = canonicalKey("search_text", { terms: ["a"] });
    expect(key.ok).toBe(true);
    if (!key.ok) {
      return;
    }
    expect(tracker.check(key.value).ok).toBe(true);
    const dup = tracker.check(key.value);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe("TOOL_DUPLICATE_CALL");
    }
  });
});

describe("createToolRegistry", () => {
  it("rejects invalid args without calling the handler", async () => {
    let called = false;
    const registry = createToolRegistry({
      handlers: {
        search_text: async () => {
          called = true;
          return { ok: true, data: { hits: [] }, truncated: false };
        },
      },
    });
    const out = await registry.invoke(
      "search_text",
      { terms: [] },
      { signal: abortSignal() },
    );
    expect(called).toBe(false);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("TOOL_ARGS_INVALID");
    }
  });

  it("dispatches to a registered handler", async () => {
    const registry = createToolRegistry({
      handlers: {
        search_by_title: async (args) => ({
          ok: true,
          data: { hits: [], query: args.query },
          truncated: false,
        }),
      },
    });
    const out = await registry.invoke(
      "search_by_title",
      { query: "Hello" },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.truncated).toBe(false);
      expect(out.data).toEqual({ hits: [], query: "Hello" });
    }
  });

  it("returns INTERNAL when handler is missing", async () => {
    const registry = createToolRegistry();
    const out = await registry.invoke(
      "get_links",
      { paths: ["a.md"] },
      { signal: abortSignal() },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe("INTERNAL");
    }
  });

  it("exposes canonicalKey as string or null", () => {
    const registry = createToolRegistry();
    expect(registry.canonicalKey("search_text", { terms: ["z", "a"] })).toBe(
      'search_text:{"terms":["a","z"]}',
    );
    expect(registry.canonicalKey("search_text", { terms: [] })).toBeNull();
  });
});

describe("result caps", () => {
  it("clips frontmatter strings and caps excerpts", () => {
    expect(clipFrontmatterString("x".repeat(250)).length).toBe(200);
    expect(capExcerpts([1, 2, 3, 4])).toEqual([1, 2]);
    expect(clampMaxChars(9000)).toBe(4000);
  });
});
