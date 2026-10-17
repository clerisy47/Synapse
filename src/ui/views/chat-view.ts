/** Safe DOM shell. The composition root supplies state and action callbacks. */
import { CSS_PREFIX, QUOTE_DISPLAY_CHARS } from "../../constants";
import type { Disposable, Observable, NavigationPort } from "../../core";
import { CHAT, ERROR_NOTICES, REMEDIATION } from "../strings/en";
import type { ChatCitation, ChatState } from "../viewmodels/chat";

export type ChatActions = {
  submit(question: string): void;
  cancel(id: number): void;
  openCitation?: (citation: ChatCitation) => void;
};
export type MountChatViewOptions = { el: HTMLElement; state: Observable<ChatState>; actions: ChatActions; navigation?: NavigationPort; onNavigationError?: () => void };

export function mountChatView({ el, state, actions, navigation, onNavigationError }: MountChatViewOptions): Disposable {
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
      if (message.status === "failed") append(row, "p", "chat-answer", message.errorHint === "bonsai_runtime" ? REMEDIATION.bonsai_runtime : ERROR_NOTICES[message.errorCode ?? "INTERNAL"]);
      const sources: { key: string; citation: ChatCitation; sourced: boolean }[] = [];
      const sourceKey = (citation: ChatCitation, sourced: boolean): string => JSON.stringify([
        citation.excerpt.ref, citation.excerpt.locator, citation.excerpt.textHash,
        citation.excerpt.sourceMtime, citation.excerpt.text, sourced,
      ]);
      for (const claim of message.claims) {
        const paragraph = append(row, "p", "chat-answer", claim.text);
        const seen = new Set<string>();
        if (!claim.sourced) append(row, "span", "chat-unverified", CHAT.unverified);
        for (const citation of claim.citations) {
          const sourced = claim.sourced && citation.status === "sourced";
          const path = citation.excerpt.ref.path;
          const title = path.slice(path.lastIndexOf("/") + 1);
          const key = sourceKey(citation, sourced);
          if (seen.has(key)) continue;
          seen.add(key);
          let index = sources.findIndex(source => source.key === key);
          if (index < 0) { index = sources.length; sources.push({ key, citation, sourced }); }
          const button = append(paragraph, "button", "chat-citation", `[${index + 1}]`);
          button.setAttribute("aria-label", `[${index + 1}] ${title}`);
          button.type = "button";
          button.disabled = !sourced || !actions.openCitation && !navigation;
          button.title = `${title} — ${sourced ? CHAT.located : CHAT.unverified}`;
          button.addEventListener("click", () => {
            if (disposed || !sourced || !state.get().messages.some((m) => m.id === message.id && m.claims.some((c) => c.citations.includes(citation)))) return;
            if (navigation) {
              const { excerpt } = citation;
              void navigation.openAt({ path: excerpt.ref.path, ...excerpt.locator, quote: excerpt.text })
                .catch(() => { if (!disposed) onNavigationError?.(); });
            } else actions.openCitation?.(citation);
          });

        }
      }
      if (sources.length > 0) {
        const details = append(row, "details", "chat-sources");
        append(details, "summary", "chat-sources-summary", `${CHAT.sources} (${sources.length})`);
        sources.forEach(({ citation, sourced }, index) => {
          const path = citation.excerpt.ref.path;
          append(details, "p", "chat-source-title", `[${index + 1}] ${path.slice(path.lastIndexOf("/") + 1)}${sourced ? "" : ` — ${CHAT.unverified}`}`);
          const text = readableExcerpt(citation.excerpt.text);
          append(details, "blockquote", "chat-quote", text.length > QUOTE_DISPLAY_CHARS
            ? `${text.slice(0, QUOTE_DISPLAY_CHARS).trimEnd()}… ${CHAT.truncated}` : text);
        });
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
        append(details, "p", "chat-hop", `${hop.n}. ${hop.tool} ${hop.args && typeof hop.args === "object" && Object.keys(hop.args).length > 0 ? JSON.stringify(hop.args) + " " : ""}— ${hop.resultCount} ${CHAT.results}, ${Math.round(hop.ms)} ${CHAT.milliseconds}${hop.rejected ? ` (${CHAT.rejections[hop.rejected]})` : ""}`);
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

/** Display-only plain text. Original evidence remains untouched for verification/navigation. */
function readableExcerpt(text: string): string {
  return text
    .replace(/!?\[\[([^\]\n]+)\]\]/gu, (_match, target: string) => target.split("|").pop() ?? target)
    .replace(/!?\[([^\]\n]+)\]\([^\n)]*\)/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/(\*\*|__|~~|`)/gu, "")
    .trim();
}
