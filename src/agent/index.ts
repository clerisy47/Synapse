/**
 * agent — Q&A state machine, budgets, selectors, prompts (DESIGN §3 / §5.4 / §6.2).
 */

export type { CreateRunBudgetOpts, RunBudget, RunCounters } from "./budget";
export {
  canFollowUp,
  canRetryVerify,
  canSearch,
  createRunBudget,
  fitsTokenBudget,
  maxPromptTokens,
  mustForceAnswer,
  remainingHops,
  remainingModelCalls,
  remainingReads,
} from "./budget";

export type {
  AgentEvent,
  AgentPhase,
  AgentState,
  HopRejectReason,
  NextResult,
  Rejected,
} from "./machine";
export { initialState, isRejected, next } from "./machine";

export type {
  BuildAnswerPromptOpts,
  ChatTurn,
  CompactSelectLine,
  PromptParts,
} from "./prompts";
export {
  QA_NUM_PREDICT,
  buildAnswerPrompt,
  buildPlanPrompt,
  buildSelectPrompt,
  formatCompactSelectLines,
} from "./prompts";

export type {
  CreateSelectorOpts,
  EvidenceSelector,
  SelectInput,
  SelectResult,
  SelectorStrategy,
} from "./selector";
export {
  ModelSelector,
  TopKSelector,
  createSelector,
} from "./selector";
