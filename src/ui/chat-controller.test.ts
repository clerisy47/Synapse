// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { ok, err, synapseError, type Result } from "../core";
import { createJobQueue } from "../jobs";
import { FakeClock } from "../../test/fakes";
import { createChatController, type ChatRunner } from "./chat-controller";
import type { ChatResult } from "./viewmodels/chat";
import { mountChatView } from "./views/chat-view";

const answered: ChatResult = {
  status: "answered", trace: [], claims: [{ text: "Answer", sourced: false, citations: [] }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("queued chat controller", () => {
  it("shows immediate queued progress behind health work, then runs and renders the answer", async () => {
    const jobs = createJobQueue({ clock: new FakeClock() });
    const health = deferred<Result<void>>();
    jobs.submit({ kind: "health", label: "health-check", run: () => health.promise });
    const cold = deferred<Result<ChatResult>>();
    const run = vi.fn<ChatRunner>((_input, _ctx, emit) => {
      emit({ type: "stage", stage: "planning" });
      return cold.promise;
    });
    const chat = createChatController(jobs, run);
    const el = document.createElement("div");
    const unmount = mountChatView({ el, state: chat.state, actions: chat });
    const input = el.querySelector("textarea")!;
    input.value = " Question ";
    input.dispatchEvent(new Event("input"));
    el.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(el.querySelector(".syn-chat-progress")?.textContent).toBe("Queued");
    expect(run).not.toHaveBeenCalled();
    chat.submit("duplicate");
    expect(chat.state.get().messages).toHaveLength(1);
    health.resolve(ok(undefined));
    await vi.waitFor(() => expect(el.querySelector(".syn-chat-progress")?.textContent).toBe("Planning"));
    expect(run.mock.calls[0]?.[0]).toEqual({ question: "Question", history: [] });
    cold.resolve(ok(answered));
    await vi.waitFor(() => expect(el.querySelector(".syn-chat-answer")?.textContent).toBe("Answer"));
    expect(chat.state.get().activeId).toBeNull();
    unmount(); chat.dispose(); jobs.dispose();
  });

  it("cancel aborts the job and ignores late events/results while the next turn waits", async () => {
    const jobs = createJobQueue({ clock: new FakeClock(), abortable: false });
    const first = deferred<Result<ChatResult>>();
    let emitLate: Parameters<ChatRunner>[2] = () => {};
    let signal: AbortSignal | undefined;
    const run = vi.fn<ChatRunner>((_input, ctx, emit) => {
      signal = ctx.signal; emitLate = emit;
      return first.promise;
    }).mockImplementationOnce((_input, ctx, emit) => {
      signal = ctx.signal; emitLate = emit;
      return first.promise;
    }).mockImplementationOnce(async () => ok(answered));
    const chat = createChatController(jobs, run);
    const el = document.createElement("div");
    const unmount = mountChatView({ el, state: chat.state, actions: chat });
    chat.submit("first");
    el.querySelector<HTMLButtonElement>(".syn-chat-cancel")!.click();
    expect(signal?.aborted).toBe(true);
    expect(chat.state.get().messages[0]?.status).toBe("cancelled");
    chat.submit("second");
    emitLate({ type: "stage", stage: "answering" });
    expect(chat.state.get().messages[1]?.stage).toBe("queued");
    first.resolve(ok(answered));
    await vi.waitFor(() => expect(chat.state.get().messages[1]?.status).toBe("answered"));
    expect(chat.state.get().messages[0]?.claims).toEqual([]);
    expect(run.mock.calls[1]?.[0].history).toEqual([]);
    unmount(); chat.dispose(); jobs.dispose();
  });

  it("handles queue failures and cancellation from the global command", async () => {
    const jobs = createJobQueue({ clock: new FakeClock() });
    const run = vi.fn<ChatRunner>().mockResolvedValueOnce(err(synapseError({ code: "MODEL_HTTP_ERROR", message: "Failure" })))
      .mockImplementationOnce((_input, ctx) => new Promise((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve(err(synapseError({ code: "CANCELLED", message: "Cancelled" }))));
      }));
    const chat = createChatController(jobs, run);
    chat.submit("first");
    await vi.waitFor(() => expect(chat.state.get().messages[0]?.errorCode).toBe("MODEL_HTTP_ERROR"));
    chat.submit("second");
    jobs.cancelAll();
    await vi.waitFor(() => expect(chat.state.get().messages[1]?.status).toBe("cancelled"));
    chat.dispose(); jobs.dispose();
  });

  it("retains successful history in memory and disposal cancels pending work", async () => {
    const jobs = createJobQueue({ clock: new FakeClock() });
    const run = vi.fn<ChatRunner>().mockResolvedValueOnce(ok(answered)).mockImplementationOnce((_input, ctx) =>
      new Promise((resolve) => ctx.signal.addEventListener("abort", () => resolve(ok(answered)))));
    const chat = createChatController(jobs, run);
    chat.submit("  ");
    expect(run).not.toHaveBeenCalled();
    chat.submit("first");
    await vi.waitFor(() => expect(chat.state.get().activeId).toBeNull());
    chat.submit("second");
    expect(run.mock.calls[1]?.[0].history).toEqual([{ question: "first", answer: "Answer" }]);
    chat.dispose(); chat.dispose(); chat.submit("third");
    await Promise.resolve();
    expect(chat.state.get().messages).toHaveLength(2);
    expect(chat.state.get().messages[1]?.status).toBe("cancelled");
    jobs.dispose();
  });
});

it("clears provenance, retained results and pending late events on access invalidation", async () => {
  const jobs = createJobQueue({ clock: new FakeClock(), abortable: false });
  const pending = deferred<Result<ChatResult>>();
  let late: Parameters<ChatRunner>[2] = () => {};
  const run = vi.fn<ChatRunner>().mockResolvedValueOnce(ok({ ...answered, accessVersion: "v1" }))
    .mockImplementationOnce((_input, _ctx, emit) => { late = emit; return pending.promise; })
    .mockResolvedValueOnce(ok({ ...answered, accessVersion: "v2" }));
  const chat = createChatController(jobs, run);
  chat.submit("first");
  await vi.waitFor(() => expect(chat.state.get().activeId).toBeNull());
  chat.submit("second");
  expect(run.mock.calls[1]?.[0].history).toEqual([{ question: "first", answer: "Answer", accessVersion: "v1" }]);
  chat.invalidate();
  expect(chat.state.get().messages).toEqual([]);
  chat.submit("third");
  late({ type: "hop", hop: { n: 1, tool: "read_note", args: { path: "STALE.md" }, resultCount: 1, ms: 0 } });
  pending.resolve(ok(answered));
  await vi.waitFor(() => expect(chat.state.get().activeId).toBeNull());
  expect(chat.state.get().messages).toHaveLength(1);
  expect(chat.state.get().messages[0]?.question).toBe("third");
  expect(JSON.stringify(chat.state.get())).not.toContain("STALE.md");
  expect(run.mock.calls[2]?.[0].history).toEqual([]);
  chat.dispose(); jobs.dispose();
});
