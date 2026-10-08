/**
 * Q&A chat session helpers (DESIGN §5.4 QaInput / ChatTurn).
 * Maps public history to prompt ChatTurns; multi-turn last-3 (S2 default off).
 */

import type { ChatTurn as PromptChatTurn } from "./prompts";

/** DESIGN public turn shape (question + answer pair). */
export type ChatTurn = {
  question: string;
  answer: string;
};

export type QaInput = {
  question: string;
  /** ≤3 prior Q/A pairs when multi-turn is on; ignored when off. */
  history: ChatTurn[];
};

const MAX_HISTORY_TURNS = 3;

/**
 * Convert DESIGN history into prompt turns for `buildPlanPrompt`.
 * When `multiTurn` is false, returns `[]`. Otherwise last ≤3 pairs →
 * alternating user/assistant prompt turns.
 */
export function historyForPrompt(
  input: QaInput,
  multiTurn: boolean,
): PromptChatTurn[] {
  if (!multiTurn || input.history.length === 0) {
    return [];
  }
  const recent = input.history.slice(-MAX_HISTORY_TURNS);
  const out: PromptChatTurn[] = [];
  for (const turn of recent) {
    out.push({ role: "user", text: turn.question });
    out.push({ role: "assistant", text: turn.answer });
  }
  return out;
}
