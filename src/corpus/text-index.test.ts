import { describe, expect, it } from "vitest";
import {
  asVaultPath,
  bodyStartOffset,
  foldCase,
  type Clock,
} from "../core";
import {
  createTextIndex,
  cutSnippet,
} from "./text-index";

const SAMPLE_CODEPOINTS = [
  "a",
  "Z",
  "ä",
  "ö",
  "ü",
  "ß",
  "İ",
  "Σ",
  "日",
  "🙂",
  " ",
  "\n",
];

function randomString(maxLen: number): string {
  const len = Math.floor(Math.random() * maxLen) + 1;
  let s = "";
  for (let i = 0; i < len; i++) {
    const idx = Math.floor(Math.random() * SAMPLE_CODEPOINTS.length);
    s += SAMPLE_CODEPOINTS[idx] ?? "a";
  }
  return s;
}

/** Advances mono on each yield so slice/budget checks trip without wall time. */
class SliceSpyClock implements Clock {
  yields = 0;
  private monoMs: number;
  private wall: number;

  constructor(
    startMs: number,
    private readonly advancePerYield: number,
  ) {
    this.monoMs = startMs;
    this.wall = startMs;
  }

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
    this.monoMs += this.advancePerYield;
    this.wall += this.advancePerYield;
  }

  /** Simulate work between notes so mono advances without a yield. */
  tick(ms: number): void {
    this.monoMs += ms;
    this.wall += ms;
  }
}

describe("bodyStartOffset", () => {
  it("returns 0 when there is no frontmatter fence", () => {
    expect(bodyStartOffset("hello world")).toBe(0);
    expect(bodyStartOffset("---not a fence")).toBe(0);
    expect(bodyStartOffset("")).toBe(0);
  });

  it("skips Obsidian YAML frontmatter including optional BOM", () => {
    const note = "---\ntitle: Hi\ntags: [a]\n---\nBody here\n";
    const start = bodyStartOffset(note);
    expect(note.slice(start)).toBe("Body here\n");

    const withBom = `\uFEFF${note}`;
    const bomStart = bodyStartOffset(withBom);
    expect(withBom.slice(bomStart)).toBe("Body here\n");
  });

  it("handles CRLF fences", () => {
    const note = "---\r\nkey: v\r\n---\r\nbody\r\n";
    expect(note.slice(bodyStartOffset(note))).toBe("body\r\n");
  });
});

describe("TextIndex", () => {
  it("stores folded text and bodyStart; frontmatter terms do not match", async () => {
    const index = createTextIndex();
    const path = asVaultPath("n.md");
    const original =
      "---\nsecret: classified\n---\nThe quick brown fox.\n";
    index.upsert(path, original);

    const entry = index.get(path);
    expect(entry).not.toBeNull();
    expect(entry!.bodyStart).toBe(bodyStartOffset(original));
    expect(entry!.folded).toBe(foldCase(original));
    expect(index.bytesCached()).toBe(entry!.folded.length);

    const clock = new SliceSpyClock(1_000, 1);
    const bodyHits = await index.scan({
      terms: ["quick"],
      clock,
      sliceMs: 10,
      budgetMs: 60_000,
    });
    expect(bodyHits.truncated).toBe(false);
    expect(bodyHits.hits).toHaveLength(1);
    const hit = bodyHits.hits[0];
    expect(hit).toBeDefined();
    expect(hit.start).toBeGreaterThanOrEqual(entry!.bodyStart);
    expect(cutSnippet(original, hit.start, hit.end)).toBe("quick");

    const fmHits = await index.scan({
      terms: ["classified"],
      clock,
      sliceMs: 10,
      budgetMs: 60_000,
    });
    expect(fmHits.hits).toHaveLength(0);
  });

  it("uses bodyStart 0 when there is no frontmatter", () => {
    const index = createTextIndex();
    const path = asVaultPath("plain.md");
    index.upsert(path, "Just body text");
    expect(index.get(path)!.bodyStart).toBe(0);
  });

  it("round-trips offsets between folded hits and original snippets (property)", async () => {
    const clock = new SliceSpyClock(1_000, 1);
    for (let i = 0; i < 200; i++) {
      const index = createTextIndex();
      const path = asVaultPath(`p${i}.md`);
      // Avoid accidental frontmatter fences in random text.
      let original = randomString(60).replace(/-/g, "_");
      if (original.startsWith("---")) {
        original = "x" + original;
      }
      const needle = "zz";
      const insertAt = Math.floor(original.length / 2);
      original =
        original.slice(0, insertAt) + needle + original.slice(insertAt);

      index.upsert(path, original);
      const folded = foldCase(original);
      const entry = index.get(path)!;
      expect(entry.folded).toBe(folded);
      expect(entry.folded.length).toBe(original.length);

      const result = await index.scan({
        terms: [needle],
        clock,
        sliceMs: 10_000,
        budgetMs: 60_000,
      });
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      for (const hit of result.hits) {
        expect(folded.slice(hit.start, hit.end)).toBe(foldCase(needle));
        expect(cutSnippet(original, hit.start, hit.end)).toBe(
          original.slice(hit.start, hit.end),
        );
        expect(foldCase(cutSnippet(original, hit.start, hit.end))).toBe(
          folded.slice(hit.start, hit.end),
        );
      }
    }
  });

  it("keeps removed / never-upserted paths absent from scan", async () => {
    const index = createTextIndex();
    const kept = asVaultPath("kept.md");
    const gone = asVaultPath("gone.md");
    const excluded = asVaultPath("private/secret.md");

    index.upsert(kept, "alpha beta");
    index.upsert(gone, "alpha gamma");
    index.remove(gone);
    // excluded never upserted

    expect(index.has(gone)).toBe(false);
    expect(index.has(excluded)).toBe(false);
    expect(index.paths()).toEqual([kept]);

    const clock = new SliceSpyClock(1_000, 1);
    const result = await index.scan({
      terms: ["alpha"],
      clock,
      sliceMs: 10,
      budgetMs: 60_000,
    });
    const paths = new Set(result.hits.map((h) => h.path as string));
    expect(paths.has(gone as string)).toBe(false);
    expect(paths.has(excluded as string)).toBe(false);
    expect(paths.has(kept as string)).toBe(true);
  });

  it("marks truncated and yields when budget is exhausted", async () => {
    const index = createTextIndex();
    for (let i = 0; i < 20; i++) {
      index.upsert(asVaultPath(`n${i}.md`), `note ${i} unique-token-${i}`);
    }

    // Each mono() read advances time so slice yields trip and budget expires.
    let t = 0;
    let yields = 0;
    const clock: Clock = {
      now: () => t,
      mono: () => {
        t += 20;
        return t;
      },
      todayLocal: () => "2026-01-01",
      sleep: async () => undefined,
      yieldNow: async () => {
        yields++;
      },
    };

    const result = await index.scan({
      terms: ["unique-token"],
      clock,
      sliceMs: 10,
      budgetMs: 50,
    });

    expect(yields).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("stops cleanly when AbortSignal is already aborted", async () => {
    const index = createTextIndex();
    for (let i = 0; i < 30; i++) {
      index.upsert(asVaultPath(`a${i}.md`), `content token-${i}`);
    }

    const ac = new AbortController();
    ac.abort();
    const clock = new SliceSpyClock(1_000, 1);
    const result = await index.scan({
      terms: ["content"],
      clock,
      sliceMs: 10,
      budgetMs: 60_000,
      signal: ac.signal,
    });
    expect(result.truncated).toBe(true);
    expect(result.hits).toHaveLength(0);
  });

  it("aborts mid-scan after a yield when signal fires", async () => {
    const index = createTextIndex();
    for (let i = 0; i < 10; i++) {
      index.upsert(asVaultPath(`b${i}.md`), `body word-${i}`);
    }

    const ac = new AbortController();
    let yields = 0;
    let t = 0;
    const clock: Clock = {
      now: () => t,
      mono: () => {
        t += 5;
        return t;
      },
      todayLocal: () => "2026-01-01",
      sleep: async () => undefined,
      yieldNow: async () => {
        yields++;
        ac.abort();
      },
    };

    const result = await index.scan({
      terms: ["body"],
      clock,
      sliceMs: 1,
      budgetMs: 60_000,
      signal: ac.signal,
    });

    expect(yields).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it("clear resets bytesCached", () => {
    const index = createTextIndex();
    index.upsert(asVaultPath("x.md"), "abc");
    expect(index.bytesCached()).toBeGreaterThan(0);
    index.clear();
    expect(index.bytesCached()).toBe(0);
    expect(index.paths()).toEqual([]);
  });
});
