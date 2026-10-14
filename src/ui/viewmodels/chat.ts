/** In-memory chat state. Structural inputs match the Q&A facade without I/O. */
import type { Excerpt, SynapseError } from "../../core";

export type ChatStage = "queued" | "planning" | "searching" | "selecting" | "reading" | "answering" | "verifying";
export type ChatHop = {
  n: number; tool: string; args: unknown; resultCount: number; ms: number;
  rejected?: "duplicate" | "invalid_args" | "budget";
};
export type ChatCitation = { excerpt: Excerpt; status: "sourced" | "unverified" };
export type ChatClaim = { text: string; sourced: boolean; citations: ChatCitation[] };
export type ChatResult = {
  accessVersion?: string;
  status: "answered" | "insufficient"; claims: ChatClaim[]; trace: ChatHop[];
  indexStatus?: { phase: "warming" | "ready"; indexedNotes: number; totalNotes: number };
};
export type ChatMessage = {
  accessVersion?: string;
  id: number; question: string; status: "running" | "answered" | "insufficient" | "failed" | "cancelled";
  stage: ChatStage; trace: ChatHop[]; claims: ChatClaim[];
  errorCode?: SynapseError["code"];
  indexStatus?: ChatResult["indexStatus"];
};
export type ChatState = { messages: ChatMessage[]; activeId: number | null; nextId: number };
export type ChatEvent =
  | { type: "submit"; question: string }
  | { type: "stage"; id: number; stage: ChatStage }
  | { type: "hop"; id: number; hop: ChatHop }
  | { type: "complete"; id: number; result: ChatResult }
  | { type: "fail"; id: number; error: SynapseError }
  | { type: "cancel"; id: number };

export function initialChatState(): ChatState {
  return { messages: [], activeId: null, nextId: 1 };
}

/** Run IDs prevent late events from changing a cancelled or subsequent turn. */
export function reduceChat(state: ChatState, event: ChatEvent): ChatState {
  if (event.type === "submit") {
    const question = event.question.trim();
    if (!question || state.activeId !== null) return state;
    return {
      nextId: state.nextId + 1, activeId: state.nextId,
      messages: [...state.messages, { id: state.nextId, question, status: "running", stage: "queued", trace: [], claims: [] }],
    };
  }
  if (event.id !== state.activeId) return state;
  const terminal = event.type === "complete" || event.type === "fail" || event.type === "cancel";
  return {
    ...state, activeId: terminal ? null : state.activeId,
    messages: state.messages.map((message): ChatMessage => {
      if (message.id !== event.id) return message;
      switch (event.type) {
        case "stage": return { ...message, stage: event.stage };
        case "hop": return { ...message, trace: [...message.trace, event.hop] };
        case "complete": return { ...message, status: event.result.status, ...(event.result.accessVersion ? { accessVersion: event.result.accessVersion } : {}), claims: event.result.status === "insufficient" ? [] : event.result.claims, trace: event.result.trace, indexStatus: event.result.indexStatus };
        case "fail": return { ...message, status: event.error.code === "CANCELLED" ? "cancelled" : "failed", errorCode: event.error.code };
        case "cancel": return { ...message, status: "cancelled" };
      }
    }),
  };
}
