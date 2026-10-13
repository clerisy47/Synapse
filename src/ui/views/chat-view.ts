/** Safe DOM shell. The composition root supplies state and action callbacks. */
import { CSS_PREFIX, QUOTE_DISPLAY_CHARS } from "../../constants";
import type { Disposable, Observable } from "../../core";
import { CHAT, ERROR_NOTICES } from "../strings/en";
import type { ChatCitation, ChatState } from "../viewmodels/chat";

export type ChatActions = {
  submit(question: string): void;
  cancel(id: number): void;
  openCitation?: (citation: ChatCitation) => void;
};
export type MountChatViewOptions = { el: HTMLElement; state: Observable<ChatState>; actions: ChatActions };

export function mountChatView({ el, state, actions }: MountChatViewOptions): Disposable {
  const doc = el.ownerDocument;
  el.classList.add(`${CSS_PREFIX}-chat`);
  el.replaceChildren();
  function append<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
    const child = doc.createElement(tag);
    child.className = `${CSS_PREFIX}-${cls}`;
    child.textContent = text;
    parent.appendChild(child);
    return child;
  }
  const messages = append(el, "div", "chat-messages");
  const progress = append(el, "div", "chat-progress");
  progress.setAttribute("role", "status");
  progress.setAttribute("aria-live", "polite");
  const form = append(el, "form", "chat-form");
  const label = append(form, "label", "chat-label", CHAT.question);
  const input = append(label, "textarea", "chat-input");
  input.placeholder = CHAT.placeholder;
  const submit = append(form, "button", "chat-submit", CHAT.submit);
  submit.type = "submit";
  const cancel = append(form, "button", "chat-cancel", CHAT.cancel);
  cancel.type = "button";
  let disposed = false;
  function updateControls(): void {
    const busy = state.get().activeId !== null;
    submit.disabled = busy || !input.value.trim();
    cancel.disabled = !busy;
    input.disabled = busy;
  }
  function onSubmit(event: Event): void {
    event.preventDefault();
    const question = input.value.trim();
    if (disposed || !question || state.get().activeId !== null) return;
    actions.submit(question);
    input.value = "";
    updateControls();
  }
  function onCancel(): void {
    const id = state.get().activeId;
    if (!disposed && id !== null) actions.cancel(id);
  }
  const expanded = new Set<number>();
  const traces = new Map<number, HTMLDetailsElement>();
  function paint(value: ChatState): void {
    for (const [id, details] of traces) {
      if (details.open) expanded.add(id);
      else expanded.delete(id);
    }
    traces.clear();
    messages.replaceChildren();
    const active = value.messages.find((message) => message.id === value.activeId);
    progress.textContent = active ? CHAT.stages[active.stage] : "";
    for (const message of value.messages) {
      const row = append(messages, "article", "chat-message");
      append(row, "p", "chat-question", message.question);
      if (message.status === "insufficient") append(row, "p", "chat-answer", CHAT.insufficient);
      if (message.status === "cancelled") append(row, "p", "chat-answer", CHAT.cancelled);
      if (message.status === "failed") append(row, "p", "chat-answer", ERROR_NOTICES[message.errorCode ?? "INTERNAL"]);
      for (const claim of message.claims) {
        append(row, "p", "chat-answer", claim.text);
        if (!claim.sourced) append(row, "span", "chat-unverified", CHAT.unverified);
        for (const citation of claim.citations) {
          const sourced = claim.sourced && citation.status === "sourced";
          const path = citation.excerpt.ref.path;
          const title = path.slice(path.lastIndexOf("/") + 1);
          const page = citation.excerpt.locator.page;
          const labelText = page === undefined ? title : `${title} — ${CHAT.page} ${page}`;
          const button = append(row, "button", "chat-citation", labelText);
          button.type = "button";
          button.disabled = !sourced || !actions.openCitation;
          button.title = sourced ? CHAT.located : CHAT.unverified;
          button.addEventListener("click", () => {
            if (!disposed && sourced) actions.openCitation?.(citation);
          });
          append(row, "blockquote", "chat-quote", citation.excerpt.text.slice(0, QUOTE_DISPLAY_CHARS));
        }
      }
      if (message.indexStatus?.phase === "warming") {
        append(row, "p", "chat-index", `${CHAT.indexing} ${message.indexStatus.indexedNotes}/${message.indexStatus.totalNotes}`);
      }
      const details = append(row, "details", "chat-trace");
      traces.set(message.id, details);
      details.open = expanded.has(message.id);
      append(details, "summary", "chat-trace-summary", CHAT.trace);
      details.addEventListener("toggle", () => {
        if (disposed || !details.isConnected) return;
        if (details.open) expanded.add(message.id);
        else expanded.delete(message.id);
      });
      for (const hop of message.trace) {
        append(details, "p", "chat-hop", `${hop.n}. ${hop.tool} ${JSON.stringify(hop.args)} — ${hop.resultCount} ${CHAT.results}, ${hop.ms} ${CHAT.milliseconds}${hop.rejected ? ` (${CHAT.rejections[hop.rejected]})` : ""}`);
      }
    }
    updateControls();
  }
  input.addEventListener("input", updateControls);
  form.addEventListener("submit", onSubmit);
  cancel.addEventListener("click", onCancel);
  paint(state.get());
  const unsubscribe = state.subscribe(paint);
  return () => {
    disposed = true;
    unsubscribe();
    input.removeEventListener("input", updateControls);
    form.removeEventListener("submit", onSubmit);
    cancel.removeEventListener("click", onCancel);
    el.replaceChildren();
    el.classList.remove(`${CSS_PREFIX}-chat`);
  };
}
