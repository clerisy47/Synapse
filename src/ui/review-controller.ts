import { createObservable, type Approval, type ApplyReport, type ChangeProposal, type Disposable, type Observable, type Result, type RoutingSettings } from "../core";
import type { JobHandle } from "../jobs";
import { canApprove, canGenerate, initialReviewState, reduceReview, type ReviewDecision, type ReviewEvent, type ReviewState } from "./viewmodels/review";

/** Structural feature interface keeps UI independent of feature implementations. */
export interface ReviewRunner {
  readyProposal?(): ChangeProposal | null;
  prepare(): Promise<Result<RoutingSettings>>;
  generate(destinations: readonly string[], dailyDate?: string): JobHandle<{ readonly proposal: ChangeProposal }> | null;
  approve(decisions: readonly ReviewDecision[]): Promise<Result<Approval>>;
  apply?(approval: Approval): Promise<Result<ApplyReport>>;
  onInvalidate(callback: () => void): Disposable;
  dispose(): void;
}
export interface ReviewController {
  state: Observable<ReviewState>;
  choices(destinations: readonly string[], dailyDate: string): void;
  generate(): Promise<void>;
  decide(index: number, decision: ReviewDecision): void;
  approve(): Promise<void>;
  apply(): Promise<void>;
  dispose(): void;
}
export function createReviewController(runner: ReviewRunner, routing: RoutingSettings): ReviewController {
  const state = createObservable(initialReviewState(routing));
  const ready = runner.readyProposal?.();
  if (ready) {
    const initial = state.get();
    state.set({ ...initial, phase: "review", proposal: ready, decisions: ready.changes.map(() => "undecided") });
  }
  let disposed = false;
  let generating = false;
  let token: Approval | null = null;
  let pending: JobHandle<{ readonly proposal: ChangeProposal }> | null = null;
  const dispatch = (event: ReviewEvent) => { if (!disposed) state.set(reduceReview(state.get(), event)); };
  // generate() itself resets feature authority before creating a job.
  const unsubscribe = runner.onInvalidate(() => { token = null; if (!generating && state.get().phase !== "applying") dispatch({ type: "stale" }); });
  return {
    state,
    choices(destinations, dailyDate) { dispatch({ type: "choices", destinations, dailyDate }); },
    async generate() {
      if (disposed || !canGenerate(state.get())) return;
      const selected = state.get();
      dispatch({ type: "generate" });
      try {
        generating = true;
        pending = runner.generate(selected.destinations, selected.dailyDate || undefined);
        generating = false;
        if (!pending) { dispatch({ type: "error" }); return; }
        const result = await pending.result;
        if (disposed || state.get().phase !== "generating") return;
        dispatch(result.ok ? { type: "proposal", proposal: result.value.proposal } : { type: "error" });
      } catch { generating = false; dispatch({ type: "error" }); }
    },
    decide(index, decision) { dispatch({ type: "decide", index, decision }); },
    async approve() {
      if (disposed || !canApprove(state.get())) return;
      const decisions = [...state.get().decisions];
      dispatch({ type: "validate" });
      try {
        const result = await runner.approve(decisions);
        if (!disposed && state.get().phase === "validating") { token = result.ok ? result.value : null; dispatch(result.ok ? { type: "approved" } : { type: "stale" }); }
      } catch { dispatch({ type: "stale" }); }
    },
    async apply() {
      if (disposed || state.get().phase !== "approved" || !token || !runner.apply) return;
      const approval = token; token = null;
      dispatch({ type: "apply" });
      try {
        const result = await runner.apply(approval);
        if (!disposed) dispatch(result.ok ? { type: "report", report: result.value } : { type: "stale" });
      } catch { dispatch({ type: "stale" }); }
    },
    dispose() {
      if (disposed) return;
      dispatch({ type: "cancel" });
      disposed = true;
      token = null;
      unsubscribe();
      pending?.cancel();
      runner.dispose();
    },
  };
}
