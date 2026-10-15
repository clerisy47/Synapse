import { describe, expect, it } from "vitest";
import { asVaultPath, type ChangeProposal, type RoutingSettings } from "../../core";
import { canApprove, canGenerate, initialReviewState, reduceReview } from "./review";
const routing: RoutingSettings = { version: 1, timezone: "UTC", destinations: [{ id: "topic", path: asVaultPath("Topic.md") }], daily: { id: "daily", folder: "Daily", filename: "YYYY-MM-DD.md", heading: "## Log" } };
const proposal = { changes: [{ path: "Topic.md" }, { path: "Other.md" }], issues: [] } as unknown as ChangeProposal;
describe("research review viewmodel", () => {
  it("requires configured unique destinations and an explicit daily date", () => {
    const initial = initialReviewState(routing);
    expect(canGenerate(initial)).toBe(false);
    expect(reduceReview(initial, { type: "choices", destinations: ["forged"], dailyDate: "" })).toBe(initial);
    expect(reduceReview(initial, { type: "choices", destinations: ["topic", "topic"], dailyDate: "" })).toBe(initial);
    const daily = reduceReview(initial, { type: "choices", destinations: ["daily"], dailyDate: "" });
    expect(canGenerate(daily)).toBe(false);
    expect(canGenerate(reduceReview(daily, { type: "choices", destinations: ["daily"], dailyDate: "2026-10-15" }))).toBe(true);
  });
  it("requires decisions on every change, one accepted change and no unresolved issues", () => {
    let state = reduceReview(initialReviewState(routing), { type: "choices", destinations: ["topic"], dailyDate: "" });
    state = reduceReview(state, { type: "generate" }); state = reduceReview(state, { type: "proposal", proposal });
    expect(canApprove(state)).toBe(false);
    state = reduceReview(state, { type: "decide", index: 0, decision: "accept" }); expect(canApprove(state)).toBe(false);
    state = reduceReview(state, { type: "decide", index: 1, decision: "reject" }); expect(canApprove(state)).toBe(true);
    expect(canApprove({ ...state, proposal: { ...proposal, issues: [{ code: "ambiguous" }] } })).toBe(false);
    expect(reduceReview(state, { type: "decide", index: -1, decision: "accept" })).toBe(state);
    expect(reduceReview(state, { type: "choices", destinations: ["daily"], dailyDate: "2026-10-15" })).toBe(state);
    state = reduceReview(state, { type: "validate" }); expect(canApprove(state)).toBe(false);
    state = reduceReview(state, { type: "stale" }); expect(reduceReview(state, { type: "approved" })).toBe(state);
    const canceled = reduceReview(state, { type: "cancel" }); expect(canceled.proposal).toBeNull();
    expect(reduceReview(canceled, { type: "proposal", proposal })).toBe(canceled);
  });
});
