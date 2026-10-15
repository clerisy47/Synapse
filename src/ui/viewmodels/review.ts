import type { ApplyReport, ChangeProposal, RoutingSettings } from "../../core";
export type ReviewDecision = "undecided" | "accept" | "reject";
export interface ReviewState {
  readonly phase: "selecting" | "generating" | "review" | "validating" | "approved" | "applying" | "finished" | "stale" | "error" | "canceled";
  readonly report: ApplyReport | null;
  readonly routing: RoutingSettings;
  readonly destinations: readonly string[];
  readonly dailyDate: string;
  readonly proposal: ChangeProposal | null;
  readonly decisions: readonly ReviewDecision[];
}
export type ReviewEvent =
  | { type: "choices"; destinations: readonly string[]; dailyDate: string }
  | { type: "generate" }
  | { type: "proposal"; proposal: ChangeProposal }
  | { type: "decide"; index: number; decision: ReviewDecision }
  | { type: "validate" }
  | { type: "approved" }
  | { type: "apply" }
  | { type: "report"; report: ApplyReport }
  | { type: "stale" | "error" | "cancel" };
export function initialReviewState(routing: RoutingSettings): ReviewState {
  return { phase: "selecting", report: null, routing, destinations: [], dailyDate: "", proposal: null, decisions: [] };
}
export function canGenerate(state: ReviewState): boolean {
  return state.phase === "selecting" && state.destinations.length > 0
    && (!state.destinations.includes(state.routing.daily.id) || /^\d{4}-\d{2}-\d{2}$/.test(state.dailyDate));
}
export function canApprove(state: ReviewState): boolean {
  return state.phase === "review" && !!state.proposal && !state.proposal.issues.length
    && state.decisions.length === state.proposal.changes.length && !state.decisions.includes("undecided") && state.decisions.includes("accept");
}
export function reduceReview(state: ReviewState, event: ReviewEvent): ReviewState {
  if (state.phase === "canceled") return state;
  switch (event.type) {
    case "choices": {
      if (state.phase !== "selecting") return state;
      const ids = [...state.routing.destinations.map((d) => d.id), state.routing.daily.id];
      if (new Set(event.destinations).size !== event.destinations.length || event.destinations.some((id) => !ids.includes(id))) return state;
      return { ...state, destinations: [...event.destinations], dailyDate: event.dailyDate };
    }
    case "generate": return canGenerate(state) ? { ...state, phase: "generating" } : state;
    case "proposal": return state.phase === "generating" ? { ...state, phase: "review", proposal: event.proposal, decisions: event.proposal.changes.map(() => "undecided") } : state;
    case "decide": return state.phase === "review" && Number.isInteger(event.index) && event.index >= 0 && event.index < state.decisions.length
      ? { ...state, decisions: state.decisions.map((d, i) => i === event.index ? event.decision : d) } : state;
    case "validate": return canApprove(state) ? { ...state, phase: "validating" } : state;
    case "approved": return state.phase === "validating" ? { ...state, phase: "approved" } : state;
    case "apply": return state.phase === "approved" ? { ...state, phase: "applying" } : state;
    case "report": return state.phase === "applying" ? { ...state, phase: "finished", report: event.report, proposal: null, decisions: [] } : state;
    case "stale": return { ...state, phase: "stale", proposal: null, decisions: [] };
    case "error": return ["generating", "validating"].includes(state.phase) ? { ...state, phase: "error" } : state;
    case "cancel": return { ...state, phase: "canceled", proposal: null, decisions: [] };
  }
}
