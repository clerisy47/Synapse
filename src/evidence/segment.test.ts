import { describe, expect, it } from "vitest";

import { asVaultPath, estimateTokens, type Excerpt, type SourceRef } from "../core";
import { displayQuote, QUOTE_DISPLAY_CHARS } from "./display";
import { EvidenceLedger, titleFromPath } from "./ledger";
import {
  EXCERPT_CHARS_MAX,
  EXCERPT_CHARS_MIN,
  headingBefore,
  segment,
  splitParagraphs,
} from "./segment";

const ref: SourceRef = { path: asVaultPath("Notes/idea.md"), kind: "note" };

function para(n: number, ch = "a"): string {
  return ch.repeat(n);
}

function multiPara(...lengths: number[]): string {
  return lengths.map((n) => para(n)).join("\n\n");
}

describe("splitParagraphs", () => {
  it("splits on blank lines with absolute offsets", () => {
    const text = "---\ntitle: x\n---\n\nHello\n\nWorld";
    const bodyStart = text.indexOf("Hello");
    const paras = splitParagraphs(text, bodyStart);
    expect(paras).toEqual([
      { start: bodyStart, end: bodyStart + 5 },
      { start: bodyStart + 7, end: bodyStart + 12 },
    ]);
    expect(text.slice(paras[0].start, paras[0].end)).toBe("Hello");
    expect(text.slice(paras[1].start, paras[1].end)).toBe("World");
  });
});

describe("headingBefore", () => {
  it("returns the nearest preceding ATX heading", () => {
    const text = "# One\n\nbody\n\n## Two\n\nmore";
    const pos = text.indexOf("more");
    expect(headingBefore(text, pos)).toBe("Two");
  });
});

describe("segment", () => {
  it("round-trips offsets: text.slice(start,end) === excerpt.text (property)", async () => {
    for (let i = 0; i < 80; i += 1) {
      const fm = "---\nid: t\n---\n\n";
      const lengths = [40 + (i % 30), 80 + (i % 50), 120 + (i % 100), 250 + (i % 200)];
      const body = multiPara(...lengths);
      const text = fm + body;
      const bodyStart = fm.length;
      const excerpts = await segment(text, {
        bodyStart,
        ref,
        sourceMtime: 1,
      });
      expect(excerpts.length).toBeGreaterThan(0);
      for (const e of excerpts) {
        expect(text.slice(e.locator.start, e.locator.end)).toBe(e.text);
        expect(e.textHash).toHaveLength(40);
        expect(e.ref).toEqual(ref);
        expect(e.sourceMtime).toBe(1);
        expect(e.locator.start).toBeGreaterThanOrEqual(bodyStart);
      }
    }
  });

  it("merges short paragraphs toward the 200–600 band", async () => {
    const text = multiPara(80, 80, 80);
    const excerpts = await segment(text, {
      bodyStart: 0,
      ref,
      sourceMtime: 2,
    });
    expect(excerpts.length).toBe(1);
    expect(excerpts[0].text.length).toBeGreaterThanOrEqual(EXCERPT_CHARS_MIN);
    expect(excerpts[0].text.length).toBeLessThanOrEqual(EXCERPT_CHARS_MAX);
  });

  it("splits long paragraphs at sentence boundaries", async () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} with filler words here to stretch length.`,
    );
    const long = sentences.join(" ");
    expect(long.length).toBeGreaterThan(EXCERPT_CHARS_MAX);
    const excerpts = await segment(long, {
      bodyStart: 0,
      ref,
      sourceMtime: 3,
      maxChars: EXCERPT_CHARS_MAX,
    });
    expect(excerpts.length).toBeGreaterThan(1);
    for (const e of excerpts) {
      expect(e.text.length).toBeLessThanOrEqual(EXCERPT_CHARS_MAX);
      expect(long.slice(e.locator.start, e.locator.end)).toBe(e.text);
    }
  });

  it("skips frontmatter via bodyStart and attaches heading + page", async () => {
    const body = `# Topic\n\n${para(220)}`;
    const text = `---\ntitle: x\n---\n\n${body}`;
    const bodyStart = text.indexOf("# Topic");
    const excerpts = await segment(text, {
      bodyStart,
      page: 4,
      ref,
      sourceMtime: 4,
    });
    expect(excerpts.length).toBeGreaterThanOrEqual(1);
    const withBody = excerpts.find((e) => e.text.includes("a".repeat(20)));
    expect(withBody?.locator.page).toBe(4);
    expect(withBody?.locator.heading).toBe("Topic");
    expect(withBody!.locator.start).toBeGreaterThanOrEqual(bodyStart);
  });

  it("allows a single short excerpt for brief notes", async () => {
    const text = "Short note.";
    const excerpts = await segment(text, {
      bodyStart: 0,
      ref,
      sourceMtime: 5,
    });
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0].text).toBe(text);
  });

  it("returns empty when bodyStart is at EOF", async () => {
    const text = "abc";
    await expect(
      segment(text, { bodyStart: 3, ref, sourceMtime: 0 }),
    ).resolves.toEqual([]);
  });
});

describe("displayQuote", () => {
  it("leaves short quotes unchanged", () => {
    expect(displayQuote("hello")).toBe("hello");
  });

  it("truncates to ≤300 chars by default", () => {
    const long = "x".repeat(500);
    const shown = displayQuote(long);
    expect(shown.length).toBe(QUOTE_DISPLAY_CHARS);
    expect(shown.length).toBeLessThanOrEqual(300);
    expect(shown).toBe(long.slice(0, 300));
  });

  it("honors an explicit maxChars", () => {
    expect(displayQuote("abcdef", 3)).toBe("abc");
  });
});

describe("EvidenceLedger", () => {
  function excerpt(start: number, end: number, text = "body"): Excerpt {
    return {
      ref,
      locator: { start, end },
      text,
      textHash: "a".repeat(40),
      sourceMtime: 1,
    };
  }

  it("mints sequential E1… ids", () => {
    const ledger = new EvidenceLedger();
    expect(ledger.add(excerpt(0, 10))).toBe("E1");
    expect(ledger.add(excerpt(10, 20))).toBe("E2");
    expect(ledger.get("E1")?.locator.start).toBe(0);
    expect(ledger.get("E2")?.locator.end).toBe(20);
  });

  it("dedupes by (path, page, start, end)", () => {
    const ledger = new EvidenceLedger();
    const a = excerpt(0, 50, "same");
    const b: Excerpt = {
      ...a,
      text: "different text same locator",
      textHash: "b".repeat(40),
    };
    expect(ledger.add(a)).toBe("E1");
    expect(ledger.add(b)).toBe("E1");
    expect(ledger.get("E1")?.text).toBe("same");
  });

  it("returns undefined for forged or unknown ids", () => {
    const ledger = new EvidenceLedger();
    ledger.add(excerpt(0, 5));
    expect(ledger.get("E999")).toBeUndefined();
    expect(ledger.get("E0")).toBeUndefined();
    expect(ledger.get("forged")).toBeUndefined();
    expect(ledger.get("")).toBeUndefined();
  });

  it("renderForPrompt formats blocks and respects token budget", () => {
    const ledger = new EvidenceLedger();
    const e1: Excerpt = {
      ref: { path: asVaultPath("Papers/alpha.md"), kind: "note" },
      locator: { start: 0, end: 10, heading: "Intro", page: 4 },
      text: "First excerpt text for the ledger.",
      textHash: "c".repeat(40),
      sourceMtime: 1,
    };
    const e2: Excerpt = {
      ref: { path: asVaultPath("Papers/beta.md"), kind: "note" },
      locator: { start: 0, end: 10 },
      text: "Second excerpt text that should be dropped when the budget is tiny.",
      textHash: "d".repeat(40),
      sourceMtime: 1,
    };
    const id1 = ledger.add(e1);
    const id2 = ledger.add(e2);
    expect(id1).toBe("E1");
    expect(id2).toBe("E2");

    const full = ledger.renderForPrompt("all", 10_000);
    expect(full.included).toEqual(["E1", "E2"]);
    expect(full.dropped).toEqual([]);
    expect(full.text).toContain("[E1] alpha › Intro (p.4)\nFirst excerpt");
    expect(full.text).toContain("[E2] beta\nSecond excerpt");

    const block1 = `[E1] alpha › Intro (p.4)\n${e1.text}`;
    const tight = ledger.renderForPrompt(["E1", "E2"], estimateTokens(block1));
    expect(tight.included).toEqual(["E1"]);
    expect(tight.dropped).toEqual(["E2"]);
    expect(tight.text).toBe(block1);
  });

  it("drops unknown ids listed in renderForPrompt", () => {
    const ledger = new EvidenceLedger();
    ledger.add(excerpt(0, 3, "x"));
    const out = ledger.renderForPrompt(["E1", "E9"] as never, 10_000);
    expect(out.included).toEqual(["E1"]);
    expect(out.dropped).toEqual(["E9"]);
  });
});

describe("titleFromPath", () => {
  it("strips directory and extension", () => {
    expect(titleFromPath("Notes/idea.md")).toBe("idea");
    expect(titleFromPath("alone")).toBe("alone");
  });
});
