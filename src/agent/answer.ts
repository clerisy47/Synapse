/**
 * Answer claim mapping + citation verify helpers (DESIGN §5.4 / AC-M3.4–3.6).
 */

import type { Anchor, Excerpt, ExcerptId, VaultPath } from "../core";
import {
  displayQuote,
  resolveAnchor,
  type EvidenceLedger,
} from "../evidence";
import type { AnswerOutput } from "../llm";

export type CitationStatus = "sourced" | "unverified";

export type Citation = {
  excerpt: Excerpt;
  status: CitationStatus;
};

export type AnswerClaim = {
  text: string;
  citations: Citation[];
  sourced: boolean;
};

export type ResolveNoteText = (
  path: VaultPath,
) => Promise<string | null>;

/**
 * Map model answer output to claims. Unknown ledger IDs are omitted from
 * citations here; VERIFY marks those claims unverified via unknownIds.
 */
export function mapAnswerClaims(
  output: AnswerOutput,
  ledger: EvidenceLedger,
): AnswerClaim[] {
  if (output.status === "insufficient") {
    return [];
  }
  const claims: AnswerClaim[] = [];
  for (const raw of output.claims) {
    const citations: Citation[] = [];
    for (const src of raw.sources) {
      const excerpt = ledger.get(src);
      if (excerpt === undefined) {
        continue;
      }
      citations.push({ excerpt, status: "sourced" });
    }
    claims.push({
      text: raw.text,
      citations,
      sourced: citations.length > 0,
    });
  }
  return claims;
}

/** Source IDs from the model answer that are absent from the ledger. */
export function collectUnknownSourceIds(
  output: AnswerOutput,
  ledger: EvidenceLedger,
): string[] {
  if (output.status === "insufficient") {
    return [];
  }
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const claim of output.claims) {
    for (const src of claim.sources) {
      if (seen.has(src)) {
        continue;
      }
      seen.add(src);
      if (ledger.get(src) === undefined) {
        unknown.push(src);
      }
    }
  }
  return unknown;
}

/**
 * Re-anchor each citation against current note text.
 * Vanished quotes → `unverified` (AC-M3.4 mid-run edit path).
 */
export async function attachAnchors(
  claims: AnswerClaim[],
  resolveText: ResolveNoteText,
): Promise<AnswerClaim[]> {
  const out: AnswerClaim[] = [];
  for (const claim of claims) {
    const citations: Citation[] = [];
    for (const cit of claim.citations) {
      const status = await resolveCitationStatus(cit, resolveText);
      citations.push({ excerpt: cit.excerpt, status });
    }
    out.push({
      text: claim.text,
      citations,
      sourced: citations.length > 0 && citations.every((c) => c.status === "sourced"),
    });
  }
  return out;
}

/**
 * After a failed verify retry (or skipped retry), mark claims that still cite
 * unknown IDs as unverified; keep ledger-backed citations sourced until anchor.
 */
export function markUnknownClaimsUnverified(
  output: AnswerOutput,
  claims: AnswerClaim[],
  ledger: EvidenceLedger,
): AnswerClaim[] {
  const unknown = new Set(collectUnknownSourceIds(output, ledger));
  if (unknown.size === 0) {
    return claims;
  }
  return claims.map((claim, i) => {
    const raw = output.claims[i];
    if (raw === undefined) {
      return claim;
    }
    const hasUnknown = raw.sources.some((s) => unknown.has(s));
    if (!hasUnknown) {
      return claim;
    }
    return {
      ...claim,
      sourced: false,
      citations: claim.citations.map((c) => ({
        ...c,
        status: "unverified" as const,
      })),
    };
  });
}

/** Build a display Anchor from an excerpt (quote truncated for UI). */
export function excerptToAnchor(excerpt: Excerpt): Anchor {
  return {
    quote: displayQuote(excerpt.text),
    textHash: excerpt.textHash,
    hintStart: excerpt.locator.start,
    hintLine: excerpt.locator.line ?? 0,
  };
}

async function resolveCitationStatus(
  cit: Citation,
  resolveText: ResolveNoteText,
): Promise<CitationStatus> {
  if (cit.status === "unverified") {
    return "unverified";
  }
  const text = await resolveText(cit.excerpt.ref.path);
  if (text === null) {
    return "unverified";
  }
  const resolved = resolveAnchor(text, excerptToAnchor(cit.excerpt));
  return resolved === null ? "unverified" : "sourced";
}

/** Prefer selected IDs first, then remaining ledger order for answer evidence. */
export function orderEvidenceIds(
  selected: readonly ExcerptId[],
  all: readonly ExcerptId[],
): ExcerptId[] {
  const seen = new Set<string>();
  const out: ExcerptId[] = [];
  for (const id of selected) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  for (const id of all) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
