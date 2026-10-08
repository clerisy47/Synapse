/**
 * Paragraph-aligned excerpt segmentation (DESIGN §4.1 / §5.6).
 */

import {
  sha1Hex,
  type Excerpt,
  type Locator,
  type SourceRef,
} from "../core";

/** Excerpt length bounds. Mirror EXCERPT_CHARS_* in constants (evidence cannot import it). */
export const EXCERPT_CHARS_MIN = 200;
export const EXCERPT_CHARS_MAX = 600;

export interface SegmentOptions {
  bodyStart: number;
  page?: number;
  /** Max chars per excerpt; default EXCERPT_CHARS_MAX. */
  maxChars?: number;
  ref: SourceRef;
  sourceMtime: number;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Segment note/page text into paragraph-aligned excerpts (200–600 chars).
 * Offsets are absolute into `text`; body starts at `o.bodyStart`.
 * Async so each excerpt can carry a SHA-1 `textHash` (DESIGN drift from sync stub).
 */
export async function segment(text: string, o: SegmentOptions): Promise<Excerpt[]> {
  const maxChars = o.maxChars ?? EXCERPT_CHARS_MAX;
  const bodyStart = clamp(o.bodyStart, 0, text.length);
  if (bodyStart >= text.length) {
    return [];
  }

  const paras = splitParagraphs(text, bodyStart);
  if (paras.length === 0) {
    return [];
  }

  const windows = buildWindows(text, paras, maxChars);
  const excerpts: Excerpt[] = [];

  for (const win of windows) {
    const excerptText = text.slice(win.start, win.end);
    if (excerptText.length === 0) {
      continue;
    }
    const textHash = await sha1Hex(excerptText);
    const heading = headingFor(text, win.start);
    const locator: Locator = {
      start: win.start,
      end: win.end,
    };
    if (o.page !== undefined) {
      locator.page = o.page;
    }
    if (heading !== undefined) {
      locator.heading = heading;
    }
    excerpts.push({
      ref: o.ref,
      locator,
      text: excerptText,
      textHash,
      sourceMtime: o.sourceMtime,
    });
  }

  return excerpts;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Split body into paragraph spans separated by `\n\n+`. */
export function splitParagraphs(text: string, from: number): Span[] {
  const out: Span[] = [];
  let i = from;
  while (i < text.length) {
    while (i < text.length && isParaBreak(text, i)) {
      i = skipParaBreak(text, i);
    }
    if (i >= text.length) {
      break;
    }
    const start = i;
    while (i < text.length && !isParaBreak(text, i)) {
      i += 1;
    }
    if (i > start) {
      out.push({ start, end: i });
    }
  }
  return out;
}

function isParaBreak(text: string, i: number): boolean {
  return text.charCodeAt(i) === 0x0a && i + 1 < text.length && text.charCodeAt(i + 1) === 0x0a;
}

function skipParaBreak(text: string, i: number): number {
  let j = i;
  while (j < text.length && text.charCodeAt(j) === 0x0a) {
    j += 1;
  }
  return j;
}

function buildWindows(text: string, paras: readonly Span[], maxChars: number): Span[] {
  const windows: Span[] = [];
  let i = 0;
  while (i < paras.length) {
    let start = paras[i].start;
    let end = paras[i].end;
    i += 1;
    while (end - start < EXCERPT_CHARS_MIN && i < paras.length) {
      end = paras[i].end;
      i += 1;
    }
    if (end - start <= maxChars) {
      windows.push({ start, end });
    } else {
      for (const part of splitLongSpan(text, start, end, maxChars)) {
        windows.push(part);
      }
    }
  }
  return windows;
}

/**
 * Split a long span at sentence boundaries (`.?!` + whitespace/end).
 * A single oversized sentence is hard-cut at maxChars.
 */
function splitLongSpan(
  text: string,
  start: number,
  end: number,
  maxChars: number,
): Span[] {
  const relativeBreaks = sentenceBreakOffsets(text.slice(start, end));
  const absEnds: number[] = relativeBreaks.map((r) => start + r);
  if (absEnds.length === 0 || absEnds[absEnds.length - 1] !== end) {
    absEnds.push(end);
  }

  const out: Span[] = [];
  let cursor = start;
  let packStart = start;

  for (const breakEnd of absEnds) {
    if (breakEnd <= cursor) {
      continue;
    }
    const candidateLen = breakEnd - packStart;
    if (candidateLen <= maxChars) {
      cursor = breakEnd;
      continue;
    }
    if (cursor > packStart) {
      out.push({ start: packStart, end: cursor });
      packStart = cursor;
    }
    while (breakEnd - packStart > maxChars) {
      const cut = packStart + maxChars;
      out.push({ start: packStart, end: cut });
      packStart = cut;
    }
    cursor = breakEnd;
  }
  if (cursor > packStart) {
    out.push({ start: packStart, end: cursor });
  }
  return out;
}

/**
 * Relative end offsets (into `slice`) after each sentence.
 * A break is `.?!` followed by whitespace, or `.?!` at end of slice.
 */
function sentenceBreakOffsets(slice: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const c = slice.charCodeAt(i);
    if (c !== 0x2e && c !== 0x21 && c !== 0x3f) {
      continue;
    }
    if (i + 1 === slice.length) {
      ends.push(i + 1);
      continue;
    }
    if (!isSpace(slice.charCodeAt(i + 1))) {
      continue;
    }
    let j = i + 1;
    while (j < slice.length && isSpace(slice.charCodeAt(j))) {
      j += 1;
    }
    ends.push(j);
  }
  return ends;
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Heading on the first line at `pos`, else nearest preceding ATX heading. */
export function headingFor(text: string, pos: number): string | undefined {
  const lineEnd = text.indexOf("\n", pos);
  const firstLine = text.slice(pos, lineEnd < 0 ? text.length : lineEnd);
  const atStart = ATX_HEADING.exec(firstLine);
  if (atStart) {
    return atStart[2].trim();
  }
  return headingBefore(text, pos);
}

/** Nearest preceding ATX heading text before `pos`, if any. */
export function headingBefore(text: string, pos: number): string | undefined {
  let heading: string | undefined;
  let i = 0;
  while (i < pos) {
    const lineStart = i;
    let lineEnd = text.indexOf("\n", i);
    if (lineEnd < 0 || lineEnd > pos) {
      lineEnd = pos;
    }
    const line = text.slice(lineStart, lineEnd);
    const m = ATX_HEADING.exec(line);
    if (m) {
      heading = m[2].trim();
    }
    if (lineEnd >= pos) {
      break;
    }
    i = lineEnd + 1;
  }
  return heading;
}
