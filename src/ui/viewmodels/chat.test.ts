import { describe, expect, it } from "vitest";
import { synapseError } from "../../core";
import { initialChatState, reduceChat } from "./chat";

describe("chat state", () => {
  it("guards submissions and tracks stages and hops without mutation", () => {
    const empty = initialChatState();
    expect(reduceChat(empty, { type: "submit", question: "  " })).toBe(empty);
    const running = reduceChat(empty, { type: "submit", question: " Q? " });
    expect(empty.messages).toEqual([]);
    expect(running.messages[0]?.question).toBe("Q?");
    expect(reduceChat(running, { type: "submit", question: "Another" })).toBe(running);
    let state = reduceChat(running, { type: "stage", id: 1, stage: "searching" });
    state = reduceChat(state, { type: "hop", id: 1, hop: { n: 1, tool: "search_text", args: { query: "q" }, resultCount: 2, ms: 3 } });
    expect(state.messages[0]?.stage).toBe("searching");
    expect(state.messages[0]?.trace).toHaveLength(1);
    expect(running.messages[0]?.trace).toEqual([]);
  });

  it("finishes turns, preserves history and ignores stale events", () => {
    let state = reduceChat(initialChatState(), { type: "submit", question: "First" });
    state = reduceChat(state, { type: "complete", id: 1, result: {
      status: "answered", claims: [{ text: "Answer", sourced: false, citations: [] }], trace: [],
      indexStatus: { phase: "warming", indexedNotes: 1, totalNotes: 2 },
    } });
    expect(state.activeId).toBeNull();
    expect(state.messages[0]?.claims[0]?.sourced).toBe(false);
    state = reduceChat(state, { type: "submit", question: "Second" });
    expect(state.activeId).toBe(2);
    expect(state.messages).toHaveLength(2);
    expect(reduceChat(state, { type: "stage", id: 1, stage: "reading" })).toBe(state);
    state = reduceChat(state, { type: "complete", id: 2, result: { status: "insufficient", claims: [{ text: "Must not render", sourced: true, citations: [] }], trace: [] } });
    expect(state.messages[1]?.claims).toEqual([]);
  });

  it("handles errors and cancellation, ignoring subsequent completion", () => {
    const running = reduceChat(initialChatState(), { type: "submit", question: "Q" });
    const failed = reduceChat(running, { type: "fail", id: 1, error: synapseError({ code: "MODEL_TIMEOUT", message: "private diagnostic" }) });
    expect(failed.messages[0]?.status).toBe("failed");
    expect(failed.messages[0]).not.toHaveProperty("error");
    const cancelled = reduceChat(running, { type: "cancel", id: 1 });
    expect(cancelled.activeId).toBeNull();
    expect(reduceChat(cancelled, { type: "complete", id: 1, result: { status: "answered", claims: [], trace: [] } })).toBe(cancelled);
    expect(reduceChat(running, { type: "fail", id: 1, error: synapseError({ code: "CANCELLED", message: "cancel" }) }).messages[0]?.status).toBe("cancelled");
  });
});
