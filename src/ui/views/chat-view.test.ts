// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { asVaultPath, createObservable, synapseError, type Excerpt } from "../../core";
import { initialChatState, reduceChat, type ChatState } from "../viewmodels/chat";
import { mountChatView } from "./chat-view";

function setup(initial = initialChatState()) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const state = createObservable<ChatState>(initial);
  const actions = { submit: vi.fn(), cancel: vi.fn(), openCitation: vi.fn() };
  const dispose = mountChatView({ el, state, actions });
  return { el, state, actions, dispose };
}
const excerpt: Excerpt = {
  ref: { path: asVaultPath("Notes/source.md"), kind: "note" },
  locator: { start: 0, end: 600 }, text: "x".repeat(600), textHash: "hash", sourceMtime: 1,
};

describe("chat pane", () => {
  it("renders model and question text inert, and routes only sourced citations", () => {
    const question = '<img src=x onerror="alert(1)"> [[x]]';
    const running = reduceChat(initialChatState(), { type: "submit", question });
    const complete = reduceChat(running, { type: "complete", id: 1, result: {
      status: "answered", trace: [], claims: [
        { text: question, sourced: true, citations: [{ excerpt, status: "sourced" }] },
        { text: "Uncertain", sourced: false, citations: [{ excerpt, status: "unverified" }] },
      ], indexStatus: { phase: "warming", indexedNotes: 2, totalNotes: 5 },
    } });
    const { el, actions, dispose } = setup(complete);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain(question);
    expect(el.textContent).toContain("Unverified");
    expect(el.textContent).toContain("2/5");
    expect(el.querySelector("blockquote")?.textContent).toHaveLength(300);
    const citations = el.querySelectorAll<HTMLButtonElement>(".syn-chat-citation");
    citations[0]?.click();
    citations[1]?.click();
    expect(actions.openCitation).toHaveBeenCalledTimes(1);
    expect(citations[1]?.disabled).toBe(true);
    dispose(); el.remove();
  });

  it("routes the full sourced excerpt through NavigationPort and handles rejection", async () => {
    const el = document.createElement("div");
    const running = reduceChat(initialChatState(), { type: "submit", question: "Q" });
    const state = createObservable(reduceChat(running, { type: "complete", id: 1, result: {
      status: "answered", trace: [], claims: [
        { text: "Answer", sourced: true, citations: [{ excerpt, status: "sourced" }] },
        { text: "Uncertain", sourced: false, citations: [{ excerpt, status: "unverified" }] },
      ],
    } }));
    const navigation = { openAt: vi.fn().mockRejectedValue(new Error("unavailable")) };
    const onNavigationError = vi.fn();
    const dispose = mountChatView({ el, state, actions: { submit: vi.fn(), cancel: vi.fn() }, navigation, onNavigationError });
    const buttons = el.querySelectorAll<HTMLButtonElement>(".syn-chat-citation");
    buttons[0]?.click();
    buttons[1]?.click();
    await Promise.resolve();
    expect(navigation.openAt).toHaveBeenCalledExactlyOnceWith({ path: excerpt.ref.path, ...excerpt.locator, quote: excerpt.text });
    expect(onNavigationError).toHaveBeenCalledTimes(1);
    dispose();
    buttons[0]?.click();
    expect(navigation.openAt).toHaveBeenCalledTimes(1);
  });

  it("keeps trace collapsed by default and preserves expansion across progress", () => {
    const running = reduceChat(initialChatState(), { type: "submit", question: "Q" });
    const { el, state, dispose } = setup(running);
    const details = el.querySelector("details");
    expect(details?.open).toBe(false);
    if (!details) throw new Error("Missing trace");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    state.set(reduceChat(state.get(), { type: "hop", id: 1, hop: { n: 1, tool: "search_text", args: { query: "word" }, resultCount: 0, ms: 7, rejected: "duplicate" } }));
    expect(el.querySelector("details")?.open).toBe(true);
    expect(el.textContent).toContain("word");
    expect(el.textContent).toContain("Duplicate skipped");
    state.set(reduceChat(state.get(), { type: "stage", id: 1, stage: "reading" }));
    expect(el.querySelector('[role="status"]')?.textContent).toBe("Reading");
    dispose(); el.remove();
  });

  it("guards blank and concurrent submissions, cancels and cleans up", () => {
    const { el, state, actions, dispose } = setup();
    const input = el.querySelector("textarea");
    const form = el.querySelector("form");
    if (!input || !form) throw new Error("Missing composer");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(actions.submit).not.toHaveBeenCalled();
    input.value = " Q? "; input.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(actions.submit).toHaveBeenCalledWith("Q?");
    state.set(reduceChat(state.get(), { type: "submit", question: "Q?" }));
    expect(input.disabled).toBe(true);
    input.value = "Other";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(actions.submit).toHaveBeenCalledTimes(1);
    const cancel = el.querySelector<HTMLButtonElement>(".syn-chat-cancel");
    cancel?.click(); expect(actions.cancel).toHaveBeenCalledWith(1);
    state.set(reduceChat(state.get(), { type: "cancel", id: 1 }));
    expect(el.textContent).toContain("Question cancelled.");
    expect(input.disabled).toBe(false);
    dispose();
    cancel?.click();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    state.set(initialChatState());
    expect(el.childNodes).toHaveLength(0);
    expect(actions.cancel).toHaveBeenCalledTimes(1);
    expect(actions.submit).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it("shows insufficient evidence and safe error copy", () => {
    const running = reduceChat(initialChatState(), { type: "submit", question: "Q" });
    const { el, state, dispose } = setup(reduceChat(running, { type: "complete", id: 1, result: { status: "insufficient", claims: [], trace: [] } }));
    expect(el.textContent).toContain("insufficient evidence");
    expect(el.querySelector(".syn-chat-citation")).toBeNull();
    state.set(reduceChat(running, { type: "fail", id: 1, error: synapseError({ code: "MODEL_TIMEOUT", message: "secret body" }) }));
    expect(el.textContent).toContain("timed out");
    expect(el.textContent).not.toContain("secret body");
    dispose(); el.remove();
  });
});
