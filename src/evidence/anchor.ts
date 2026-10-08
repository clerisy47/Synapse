/**
 * Quote-first anchor resolution (DESIGN §5.6 / ADR-15).
 * Hint disambiguates duplicate quotes; vanished quote → null (stale).
 */

import type { Anchor } from "../core";

export interface ResolvedAnchor {
  start: number;
  end: number;
}

/**
 * Re-locate `a.quote` in `currentText` after edits.
 * Exact match only; among duplicates pick closest to `a.hintStart` (ties → leftmost).
 * Empty or missing quote → null.
 */
export function resolveAnchor(
  currentText: string,
  a: Anchor,
): ResolvedAnchor | null {
  const quote = a.quote;
  if (quote.length === 0) {
    return null;
  }

  const starts = findAllStarts(currentText, quote);
  const first = starts[0];
  if (first === undefined) {
    return null;
  }

  let best = first;
  let bestDist = Math.abs(best - a.hintStart);
  for (let i = 1; i < starts.length; i += 1) {
    const start = starts[i];
    if (start === undefined) {
      break;
    }
    const dist = Math.abs(start - a.hintStart);
    if (dist < bestDist || (dist === bestDist && start < best)) {
      best = start;
      bestDist = dist;
    }
  }

  return { start: best, end: best + quote.length };
}

function findAllStarts(text: string, quote: string): number[] {
  const out: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const i = text.indexOf(quote, from);
    if (i < 0) {
      break;
    }
    out.push(i);
    from = i + 1;
  }
  return out;
}
