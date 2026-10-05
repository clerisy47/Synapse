import { describe, expect, it } from "vitest";
import {
  asVaultPath,
  estimateTokens,
  foldCase,
  hashPathForLog,
  normalizeClaimText,
  sha1Hex,
  stableStringify,
} from "./index";

const SAMPLE_CODEPOINTS = [
  "a",
  "Z",
  "ä",
  "ö",
  "ü",
  "ß",
  "İ",
  "Σ",
  "Ω",
  "日",
  "本",
  "🙂",
  "\u0300",
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

describe("foldCase", () => {
  it("lowercases ASCII", () => {
    expect(foldCase("Hello WORLD")).toBe("hello world");
  });

  it("preserves length when lower-case changes code unit count", () => {
    const turkish = "İ";
    const folded = foldCase(turkish);
    expect(folded.length).toBe(turkish.length);
  });

  it("is length-preserving on random strings (property)", () => {
    for (let i = 0; i < 1500; i++) {
      const s = randomString(80);
      expect(foldCase(s).length).toBe(s.length);
    }
  });
});

describe("normalizeClaimText", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeClaimText("  Foo   BAR  ")).toBe("foo bar");
  });
});

describe("estimateTokens", () => {
  it("counts non-ASCII conservatively", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(Math.ceil(4 / 3.2));
    expect(estimateTokens("日")).toBe(1);
    expect(estimateTokens("a日")).toBe(1 + Math.ceil(1 / 3.2));
  });
});

describe("stableStringify", () => {
  it("sorts object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("sha1Hex", () => {
  it("matches known SHA-1 vector", async () => {
    if (!crypto.subtle) {
      return;
    }
    await expect(sha1Hex("abc")).resolves.toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    );
  });

  it("hashPathForLog uses h: prefix and 8 hex chars", async () => {
    if (!crypto.subtle) {
      return;
    }
    const tag = await hashPathForLog(asVaultPath("Notes/foo.md"));
    expect(tag).toMatch(/^h:[0-9a-f]{8}$/);
  });
});
