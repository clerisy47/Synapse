/** In-memory chat lifecycle. All pipeline work enters the shared model queue. */
import { createObservable, type Observable, type Result } from "../core";
import type { JobContext, JobHandle, JobQueue } from "../jobs";
import {
  initialChatState, reduceChat,
  type ChatEvent, type ChatHop, type ChatResult, type ChatStage, type ChatState,
} from "./viewmodels/chat";

export type ChatRunner = (
  input: { question: string; history: { question: string; answer: string; accessVersion?: string }[] },
  ctx: JobContext,
  emit: (event: { type: "stage"; stage: ChatStage } | { type: "hop"; hop: ChatHop }) => void,
) => Promise<Result<ChatResult>>;

export type ChatController = {
  state: Observable<ChatState>;
  submit(question: string): void;
  cancel(id: number): void;
  invalidate(): void;
  dispose(): void;
};

export function createChatController(jobs: JobQueue, run: ChatRunner): ChatController {
  const state = createObservable(initialChatState());
  let active: { id: number; handle: JobHandle<ChatResult> } | null = null;
  let disposed = false;
  function dispatch(event: ChatEvent): void {
    if (!disposed) state.set(reduceChat(state.get(), event));
  }
  function cancel(id: number): void {
    if (id !== state.get().activeId) return;
    dispatch({ type: "cancel", id });
    active?.handle.cancel();
    active = null;
  }
  return {
    state,
    submit(question) {
      if (disposed || !question.trim() || state.get().activeId !== null) return;
      // Publish before queue submission: even a cold/busy provider gets immediate UI progress.
      const history = state.get().messages.filter((m) => m.status === "answered")
        .map((m) => ({ question: m.question, answer: m.claims.map((c) => c.text).join("\n"), ...(m.accessVersion ? { accessVersion: m.accessVersion } : {}) }));
      dispatch({ type: "submit", question });
      const id = state.get().activeId;
      if (id === null) return;
      const handle = jobs.submit<ChatResult>({
        kind: "qa", label: "qa",
        run: (ctx) => run({ question: question.trim(), history }, ctx, (event) => {
          if (event.type === "stage") dispatch({ type: "stage", id, stage: event.stage });
          else dispatch({ type: "hop", id, hop: event.hop });
        }),
      });
      active = { id, handle };
      void handle.result.then((result) => {
        if (active?.id === id) active = null;
        if (result.ok) dispatch({ type: "complete", id, result: result.value });
        else dispatch({ type: "fail", id, error: result.error });
      });
    },
    cancel,
    invalidate() {
      const id = state.get().activeId;
      if (id !== null) cancel(id);
      if (!disposed) state.set({ ...initialChatState(), nextId: state.get().nextId });
    },
    dispose() {
      if (disposed) return;
      const id = state.get().activeId;
      if (id !== null) cancel(id);
      disposed = true;
    },
  };
}
