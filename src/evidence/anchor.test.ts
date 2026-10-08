import { describe, expect, it } from "vitest";

import type { Anchor } from "../core";
import { resolveAnchor } from "./anchor";

function anchor(partial: Partial<Anchor> & Pick<Anchor, "quote">): Anchor {
  return {
    textHash: "a".repeat(40),
    hintStart: 0,
    hintLine: 0,
    ...partial,
  };
}

describe("resolveAnchor", () => {
  it("resolves unchanged buffer to original offsets", () => {
    const text = "Intro\n\nThe claim is here.\n\nOutro";
    const quote = "The claim is here.";
    const start = text.indexOf(quote);
    const a = anchor({ quote, hintStart: start, hintLine: 2 });
    const r = resolveAnchor(text, a);
    expect(r).toEqual({ start, end: start + quote.length });
    expect(text.slice(r!.start, r!.end)).toBe(quote);
  });

  it("finds quote after prefix insert (edited buffer)", () => {
    const original = "AAA\n\nBody quote text.\n\nZZZ";
    const quote = "Body quote text.";
    const hintStart = original.indexOf(quote);
    const edited = "PREFIX\n\n" + original;
    const expected = edited.indexOf(quote);
    const r = resolveAnchor(edited, anchor({ quote, hintStart }));
    expect(r).toEqual({ start: expected, end: expected + quote.length });
    expect(edited.slice(r!.start, r!.end)).toBe(quote);
  });

  it("picks the duplicate nearer to hintStart", () => {
    const quote = "same";
    const text = "same --- pad --- same";
    const first = 0;
    const second = text.lastIndexOf(quote);
    expect(resolveAnchor(text, anchor({ quote, hintStart: first }))).toEqual({
      start: first,
      end: first + quote.length,
    });
    expect(resolveAnchor(text, anchor({ quote, hintStart: second }))).toEqual({
      start: second,
      end: second + quote.length,
    });
  });

  it("breaks equidistant ties with leftmost start", () => {
    const quote = "x";
    // positions 0 and 4; hintStart=2 → equal distance 2 → leftmost
    const text = "x---x";
    const r = resolveAnchor(text, anchor({ quote, hintStart: 2 }));
    expect(r).toEqual({ start: 0, end: 1 });
  });

  it("returns null when quote deleted", () => {
    const text = "Nothing relevant remains.";
    const r = resolveAnchor(
      text,
      anchor({ quote: "vanished passage", hintStart: 5 }),
    );
    expect(r).toBeNull();
  });

  it("returns null when quote edited", () => {
    const text = "The claim was changed.";
    const r = resolveAnchor(
      text,
      anchor({ quote: "The claim is here.", hintStart: 0 }),
    );
    expect(r).toBeNull();
  });

  it("returns null for empty quote", () => {
    expect(resolveAnchor("any text", anchor({ quote: "" }))).toBeNull();
  });

  it("still resolves when hintStart is past EOF or negative", () => {
    const text = "Find me here";
    const quote = "Find me here";
    expect(
      resolveAnchor(text, anchor({ quote, hintStart: 9999 })),
    ).toEqual({ start: 0, end: quote.length });
    expect(
      resolveAnchor(text, anchor({ quote, hintStart: -50 })),
    ).toEqual({ start: 0, end: quote.length });
  });
});
