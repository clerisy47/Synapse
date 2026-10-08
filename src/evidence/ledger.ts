/**
 * Per-run evidence ledger (DESIGN §3.1 / §4.2 / §5.6).
 */

import {
  estimateTokens,
  type Excerpt,
  type ExcerptId,
} from "../core";

export interface PromptRenderResult {
  text: string;
  included: ExcerptId[];
  dropped: ExcerptId[];
}

/**
 * Mints per-run excerpt IDs (`E1…`). Not persisted.
 * Forged or unknown IDs resolve to `undefined` via {@link EvidenceLedger.get}.
 */
export class EvidenceLedger {
  private readonly byId = new Map<string, Excerpt>();
  private readonly dedupe = new Map<string, ExcerptId>();
  private next = 1;

  add(e: Excerpt): ExcerptId {
    const key = dedupeKey(e);
    const existing = this.dedupe.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = mintExcerptId(this.next);
    this.next += 1;
    this.byId.set(id, e);
    this.dedupe.set(key, id);
    return id;
  }

  get(id: string): Excerpt | undefined {
    return this.byId.get(id);
  }

  /**
   * Render ledger excerpts for a model prompt within a token budget.
   * Format: `[E3] Title › Heading (p.4)\n<text>`
   */
  renderForPrompt(
    ids: ExcerptId[] | "all",
    maxTokens: number,
  ): PromptRenderResult {
    const ordered = ids === "all" ? this.allIds() : ids;
    const included: ExcerptId[] = [];
    const dropped: ExcerptId[] = [];
    const parts: string[] = [];
    let used = 0;

    for (const id of ordered) {
      const excerpt = this.byId.get(id);
      if (excerpt === undefined) {
        dropped.push(id);
        continue;
      }
      const block = formatBlock(id, excerpt);
      const sepCost = parts.length > 0 ? estimateTokens("\n") : 0;
      const cost = sepCost + estimateTokens(block);
      if (used + cost > maxTokens) {
        dropped.push(id);
        continue;
      }
      parts.push(block);
      included.push(id);
      used += cost;
    }

    return {
      text: parts.join("\n"),
      included,
      dropped,
    };
  }

  private allIds(): ExcerptId[] {
    const ids: ExcerptId[] = [];
    for (let n = 1; n < this.next; n += 1) {
      const id = mintExcerptId(n);
      if (this.byId.has(id)) {
        ids.push(id);
      }
    }
    return ids;
  }
}

function mintExcerptId(n: number): ExcerptId {
  return `E${n}`;
}

function dedupeKey(e: Excerpt): string {
  const page = e.locator.page === undefined ? "" : String(e.locator.page);
  return `${e.ref.path}\0${page}\0${e.locator.start}\0${e.locator.end}`;
}

function formatBlock(id: ExcerptId, e: Excerpt): string {
  const title = titleFromPath(e.ref.path);
  let header = `[${id}] ${title}`;
  if (e.locator.heading) {
    header += ` › ${e.locator.heading}`;
  }
  if (e.locator.page !== undefined) {
    header += ` (p.${e.locator.page})`;
  }
  return `${header}\n${e.text}`;
}

/** Basename without extension, used as citation title when DocMeta is absent. */
export function titleFromPath(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return base;
  }
  return base.slice(0, dot);
}
