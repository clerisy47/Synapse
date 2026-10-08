/**
 * Pure Q&A agent state machine (DESIGN §6.2).
 * Cancel / model transport errors are handled outside this module.
 */

import {
  canFollowUp,
  canRetryVerify,
  mustForceAnswer,
  remainingModelCalls,
  remainingReads,
  type RunBudget,
} from "./budget";

export type AgentPhase =
  | "PLAN"
  | "SEARCH"
  | "SELECT"
  | "READ"
  | "ANSWER"
  | "VERIFY"
  | "DONE"
  | "INSUFFICIENT";

export type HopRejectReason = "duplicate" | "invalid_args" | "budget";

export interface AgentState {
  phase: AgentPhase;
  hops: number;
  reads: number;
  modelCalls: number;
  followupsUsed: 0 | 1;
  verifyRetries: 0 | 1;
  /** Pending read_note calls after SELECT (cleared on readsDone). */
  pendingReads: number;
  lastHopRejected?: HopRejectReason;
}

export type AgentEvent =
  | { type: "planAccepted" }
  | { type: "planEmpty" }
  | { type: "toolHop"; rejected?: HopRejectReason }
  | { type: "searchDone" }
  | { type: "select"; readIds: string[]; enough: boolean }
  | { type: "readsDone" }
  | {
      type: "answer";
      status: "answered" | "insufficient";
      followup?: { terms: string[]; phrases: string[] } | null;
    }
  | { type: "verify"; unknownIds: string[] }
  | { type: "forceAnswer" }
  | { type: "wallClockExhausted" };

export type Rejected = { rejected: string };

export type NextResult = AgentState | Rejected;

export function isRejected(r: NextResult): r is Rejected {
  return "rejected" in r;
}

export function initialState(): AgentState {
  return {
    phase: "PLAN",
    hops: 0,
    reads: 0,
    modelCalls: 0,
    followupsUsed: 0,
    verifyRetries: 0,
    pendingReads: 0,
  };
}

function reject(reason: string): Rejected {
  return { rejected: reason };
}

function clone(s: AgentState): AgentState {
  return { ...s };
}

function isTerminal(phase: AgentPhase): boolean {
  return phase === "DONE" || phase === "INSUFFICIENT";
}

function validSelectPayload(event: {
  readIds: string[];
  enough: boolean;
}): boolean {
  if (typeof event.enough !== "boolean") {
    return false;
  }
  if (!Array.isArray(event.readIds)) {
    return false;
  }
  return event.readIds.every((id) => typeof id === "string" && id.length > 0);
}

function validAnswerPayload(event: {
  status: string;
  followup?: { terms: string[]; phrases: string[] } | null;
}): boolean {
  if (event.status !== "answered" && event.status !== "insufficient") {
    return false;
  }
  if (event.followup === undefined || event.followup === null) {
    return true;
  }
  const f = event.followup;
  if (typeof f !== "object") {
    return false;
  }
  return (
    Array.isArray(f.terms) &&
    Array.isArray(f.phrases) &&
    f.terms.every((t) => typeof t === "string") &&
    f.phrases.every((p) => typeof p === "string")
  );
}

/**
 * Pure transition. Invalid transitions and invalid model fields → Rejected (AC-M2.6).
 */
export function next(
  state: AgentState,
  event: AgentEvent,
  budget: RunBudget,
  activeMs: number,
): NextResult {
  if (isTerminal(state.phase) && event.type !== "wallClockExhausted") {
    return reject(`terminal:${state.phase}`);
  }

  switch (event.type) {
    case "planAccepted":
      return onPlanAccepted(state, budget);
    case "planEmpty":
      return onPlanEmpty(state);
    case "toolHop":
      return onToolHop(state, event, budget, activeMs);
    case "searchDone":
      return onSearchDone(state);
    case "select":
      return onSelect(state, event, budget);
    case "readsDone":
      return onReadsDone(state);
    case "answer":
      return onAnswer(state, event, budget, activeMs);
    case "verify":
      return onVerify(state, event, budget, activeMs);
    case "forceAnswer":
      return onForceAnswer(state, budget, activeMs);
    case "wallClockExhausted":
      return onWallClockExhausted(state);
    default:
      return reject("unknown_event");
  }
}

function onPlanAccepted(state: AgentState, budget: RunBudget): NextResult {
  if (state.phase !== "PLAN") {
    return reject("invalid_transition:planAccepted");
  }
  if (remainingModelCalls(budget, state.modelCalls) < 1) {
    const out = clone(state);
    out.phase = "INSUFFICIENT";
    return out;
  }
  const out = clone(state);
  out.phase = "SEARCH";
  out.modelCalls += 1;
  return out;
}

function onPlanEmpty(state: AgentState): NextResult {
  if (state.phase !== "PLAN") {
    return reject("invalid_transition:planEmpty");
  }
  const out = clone(state);
  out.phase = "INSUFFICIENT";
  return out;
}

function onToolHop(
  state: AgentState,
  event: { rejected?: HopRejectReason },
  budget: RunBudget,
  activeMs: number,
): NextResult {
  if (state.phase !== "SEARCH") {
    return reject("invalid_transition:toolHop");
  }
  if (
    event.rejected !== undefined &&
    event.rejected !== "duplicate" &&
    event.rejected !== "invalid_args" &&
    event.rejected !== "budget"
  ) {
    return reject("invalid_model_field:rejected");
  }
  const out = clone(state);
  out.hops += 1;
  if (event.rejected !== undefined) {
    out.lastHopRejected = event.rejected;
  } else {
    delete out.lastHopRejected;
  }
  if (out.hops >= budget.maxHops || activeMs >= budget.wallClockMs) {
    out.phase = "INSUFFICIENT";
  }
  return out;
}

function onSearchDone(state: AgentState): NextResult {
  if (state.phase !== "SEARCH") {
    return reject("invalid_transition:searchDone");
  }
  const out = clone(state);
  out.phase = "SELECT";
  return out;
}

function onSelect(
  state: AgentState,
  event: { readIds: string[]; enough: boolean },
  budget: RunBudget,
): NextResult {
  if (state.phase !== "SELECT") {
    return reject("invalid_transition:select");
  }
  if (!validSelectPayload(event)) {
    return reject("invalid_model_field:select");
  }
  if (event.readIds.length > remainingReads(budget, state.reads)) {
    return reject("budget:maxReads");
  }
  if (remainingModelCalls(budget, state.modelCalls) < 1) {
    const out = clone(state);
    out.phase = "INSUFFICIENT";
    return out;
  }
  const out = clone(state);
  out.modelCalls += 1;
  if (event.readIds.length > 0) {
    out.phase = "READ";
    out.pendingReads = event.readIds.length;
  } else {
    out.phase = "ANSWER";
    out.pendingReads = 0;
  }
  return out;
}

function onReadsDone(state: AgentState): NextResult {
  if (state.phase !== "READ") {
    return reject("invalid_transition:readsDone");
  }
  const out = clone(state);
  out.reads += out.pendingReads;
  out.pendingReads = 0;
  out.phase = "ANSWER";
  return out;
}

function onAnswer(
  state: AgentState,
  event: {
    status: "answered" | "insufficient";
    followup?: { terms: string[]; phrases: string[] } | null;
  },
  budget: RunBudget,
  activeMs: number,
): NextResult {
  if (state.phase !== "ANSWER") {
    return reject("invalid_transition:answer");
  }
  if (!validAnswerPayload(event)) {
    return reject("invalid_model_field:answer");
  }
  if (event.status === "answered" && event.followup != null) {
    return reject("invalid_model_field:followup");
  }
  if (remainingModelCalls(budget, state.modelCalls) < 1) {
    const out = clone(state);
    out.phase = "INSUFFICIENT";
    return out;
  }
  const out = clone(state);
  out.modelCalls += 1;

  if (event.status === "answered") {
    out.phase = "VERIFY";
    return out;
  }

  // insufficient
  const wantsFollowUp =
    event.followup != null &&
    (event.followup.terms.length > 0 || event.followup.phrases.length > 0);

  if (
    wantsFollowUp &&
    canFollowUp(
      budget,
      {
        hops: out.hops,
        reads: out.reads,
        modelCalls: out.modelCalls,
        followupsUsed: out.followupsUsed,
      },
      activeMs,
    )
  ) {
    out.phase = "SEARCH";
    out.followupsUsed = 1;
    return out;
  }

  out.phase = "INSUFFICIENT";
  return out;
}

function onVerify(
  state: AgentState,
  event: { unknownIds: string[] },
  budget: RunBudget,
  activeMs: number,
): NextResult {
  if (state.phase !== "VERIFY") {
    return reject("invalid_transition:verify");
  }
  if (!Array.isArray(event.unknownIds)) {
    return reject("invalid_model_field:unknownIds");
  }
  if (!event.unknownIds.every((id) => typeof id === "string")) {
    return reject("invalid_model_field:unknownIds");
  }

  const out = clone(state);
  const canRetry =
    event.unknownIds.length > 0 &&
    out.verifyRetries === 0 &&
    canRetryVerify(budget, activeMs) &&
    remainingModelCalls(budget, out.modelCalls) > 0;

  if (canRetry) {
    out.phase = "ANSWER";
    out.verifyRetries = 1;
    return out;
  }

  out.phase = "DONE";
  return out;
}

function onForceAnswer(
  state: AgentState,
  budget: RunBudget,
  activeMs: number,
): NextResult {
  if (
    state.phase !== "SEARCH" &&
    state.phase !== "SELECT" &&
    state.phase !== "READ"
  ) {
    return reject("invalid_transition:forceAnswer");
  }
  if (!mustForceAnswer(budget, activeMs)) {
    return reject("budget:forceAnswerEarly");
  }
  const out = clone(state);
  out.phase = "ANSWER";
  out.pendingReads = 0;
  return out;
}

function onWallClockExhausted(state: AgentState): NextResult {
  if (isTerminal(state.phase)) {
    return reject(`terminal:${state.phase}`);
  }
  const out = clone(state);
  out.phase = "INSUFFICIENT";
  return out;
}
