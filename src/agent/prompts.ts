/**
 * Q&A prompt builders (DESIGN §5.4 / §6.2).
 * Return instructions+input only; ModelPort adds SHARED_SYSTEM_PREFIX.
 * Provisional numPredict until Gate A (M1-T17 deferred); agent must not import constants.ts.
 */

import { estimateTokens, type ExcerptId } from "../core";

/** Mirror of constants.NUM_PREDICT for plan/select/answer (local to agent). */
export const QA_NUM_PREDICT = {
  plan: 200,
  select: 100,
  answer: 600,
} as const;

export type PromptParts = {
  instructions: string;
  input: string;
};

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export type CompactSelectLine = {
  id: ExcerptId;
  title: string;
  heading?: string;
  snippet: string;
};

export type BuildAnswerPromptOpts = {
  /** Verify-retry feedback: forged/unknown source IDs from the prior answer. */
  unknownIds?: string[];
};

const MAX_HISTORY_TURNS = 3;

const NO_PATHS =
  "Never name vault paths, file names, or regex. Use ledger IDs (E1, E2, …) and search terms only.";

/**
 * Plan prompt: question (+ ≤3 prior turns when multi-turn is on).
 */
export function buildPlanPrompt(
  question: string,
  history: ChatTurn[] = [],
): PromptParts {
  const instructions = [
    "Plan vault searches for the question.",
    "Return JSON matching the schema: 1–4 searches (search_text, search_by_title, search_by_tag, or list_recent) and expand_graph.",
    "Use short terms and phrases only — no paths.",
    NO_PATHS,
  ].join(" ");

  const parts: string[] = [];
  const recent = history.slice(-MAX_HISTORY_TURNS);
  if (recent.length > 0) {
    parts.push("Prior turns:");
    for (const turn of recent) {
      parts.push(`${turn.role}: ${turn.text}`);
    }
    parts.push("");
  }
  parts.push(`Question: ${question}`);

  return { instructions, input: parts.join("\n") };
}

/**
 * Select prompt: compact `[E#] Title › heading: snippet` lines.
 */
export function buildSelectPrompt(
  question: string,
  compactLines: string,
): PromptParts {
  const instructions = [
    "Choose which evidence excerpts to read in full.",
    "Return JSON matching the schema: read (0–4 ledger IDs from the list) and enough (true if snippets alone answer the question).",
    "Only pick IDs that appear in the candidate list.",
    NO_PATHS,
  ].join(" ");

  const input = [`Question: ${question}`, "", "Candidates:", compactLines].join(
    "\n",
  );
  return { instructions, input };
}

/**
 * Answer prompt: full evidence blocks (selected first, then rest by score).
 */
export function buildAnswerPrompt(
  question: string,
  evidenceText: string,
  opts: BuildAnswerPromptOpts = {},
): PromptParts {
  const instructions = [
    "Answer the question from the evidence below.",
    "Return JSON matching the schema: status answered|insufficient, claims with source ledger IDs, optional followup terms/phrases.",
    "Every claim must cite at least one ledger ID from the evidence. Do not invent IDs.",
    NO_PATHS,
  ].join(" ");

  const parts: string[] = [`Question: ${question}`, "", "Evidence:", evidenceText];
  if (opts.unknownIds !== undefined && opts.unknownIds.length > 0) {
    parts.push(
      "",
      `Previous answer cited unknown IDs (do not reuse): ${opts.unknownIds.join(", ")}`,
    );
  }

  return { instructions, input: parts.join("\n") };
}

/**
 * Format compact SELECT one-liners and trim to a token budget.
 * Format: `[E#] Title › heading: snippet`
 */
export function formatCompactSelectLines(
  lines: CompactSelectLine[],
  maxTokens: number,
): { text: string; included: ExcerptId[]; dropped: ExcerptId[] } {
  const included: ExcerptId[] = [];
  const dropped: ExcerptId[] = [];
  const parts: string[] = [];
  let used = 0;

  for (const line of lines) {
    const formatted = formatCompactLine(line);
    const sepCost = parts.length > 0 ? estimateTokens("\n") : 0;
    const cost = sepCost + estimateTokens(formatted);
    if (used + cost > maxTokens) {
      dropped.push(line.id);
      continue;
    }
    parts.push(formatted);
    included.push(line.id);
    used += cost;
  }

  return {
    text: parts.join("\n"),
    included,
    dropped,
  };
}

function formatCompactLine(line: CompactSelectLine): string {
  let header = `[${line.id}] ${line.title}`;
  if (line.heading !== undefined && line.heading.length > 0) {
    header += ` › ${line.heading}`;
  }
  return `${header}: ${line.snippet}`;
}
