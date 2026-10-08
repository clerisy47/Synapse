/**
 * agent — Q&A state machine and run budgets (DESIGN §3 / §5.4 / §6.2).
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
