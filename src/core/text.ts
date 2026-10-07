/**
 * Pure text helpers (DESIGN §4.1 case fold, §5.4 tokens, §8.1 path hashing).
 */

import type { VaultPath } from "./types";

/**
 * Length-preserving case fold for the text index (DESIGN §4.1).
 * Code points whose lower-case form has a different length are left unchanged.
 */
export function foldCase(s: string): string {
  let out = "";
  for (const cp of s) {
    const lower = cp.toLowerCase();
    out += lower.length === cp.length ? lower : cp;
  }
  return out;
}

/**
 * Offset of note body after an Obsidian-style YAML frontmatter fence (DESIGN §4.1).
 * Opening line must be exactly `---` (optional leading BOM); closing line exactly `---`.
 * Returns the index of the first character after the closing fence's trailing newline,
 * or `0` when no valid fence pair exists. Does not parse YAML.
 */
export function bodyStartOffset(fullText: string): number {
  let i = 0;
  if (fullText.length > 0 && fullText.charCodeAt(0) === 0xfeff) {
    i = 1;
  }
  if (!fullText.startsWith("---", i)) {
    return 0;
  }
  const afterOpenFence = i + 3;
  const afterOpenNl = skipNewline(fullText, afterOpenFence);
  if (afterOpenNl === afterOpenFence) {
    return 0;
  }

  let pos = afterOpenNl;
  while (pos < fullText.length) {
    const lineStart = pos;
    const lineEnd = findLineEnd(fullText, pos);
    const line = fullText.slice(lineStart, lineEnd);
    const afterNl = skipNewline(fullText, lineEnd);
    if (line === "---") {
      return afterNl === lineEnd ? lineEnd : afterNl;
    }
    if (afterNl === lineEnd) {
      break;
    }
    pos = afterNl;
  }
  return 0;
}

function findLineEnd(text: string, from: number): number {
  let j = from;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (c === 0x0a || c === 0x0d) {
      break;
    }
    j++;
  }
  return j;
}

/** Advance past `\n` or `\r\n` at `from`; returns `from` if no newline. */
function skipNewline(text: string, from: number): number {
  if (from >= text.length) {
    return from;
  }
  if (text.charCodeAt(from) === 0x0d) {
    if (from + 1 < text.length && text.charCodeAt(from + 1) === 0x0a) {
      return from + 2;
    }
    return from + 1;
  }
  if (text.charCodeAt(from) === 0x0a) {
    return from + 1;
  }
  return from;
}

/** For claimHash keys: lower-case and collapse whitespace (DESIGN §4.3). */
export function normalizeClaimText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function encodeUtf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha1Hex(input: string): Promise<string> {
  const subtle = crypto.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle digest unavailable");
  }
  const bytes = encodeUtf8(input);
  const digest = await subtle.digest("SHA-1", bytes as BufferSource);
  return bufferToHex(digest);
}

/** Paths in logs: h: + first 8 hex chars of SHA-1 (DESIGN §8.1). */
export async function hashPathForLog(path: VaultPath): Promise<string> {
  const hex = await sha1Hex(path);
  return `h:${hex.slice(0, 8)}`;
}

/**
 * Conservative token estimate (DESIGN §5.4): ~1 per non-ASCII code point,
 * ~1 per 3.2 ASCII characters.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const cp of text) {
    const code = cp.codePointAt(0)!;
    if (code <= 0x7f) {
      ascii += 1;
    } else {
      nonAscii += 1;
    }
  }
  return nonAscii + Math.ceil(ascii / 3.2);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, replacer);
}

function replacer(_key: string, val: unknown): unknown {
  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    const record = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) {
      sorted[k] = record[k];
    }
    return sorted;
  }
  return val;
}
