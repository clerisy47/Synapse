import type { Disposable } from "../../core";
import type { ReviewController } from "../review-controller";
import { REVIEW } from "../strings/en";
import { canApprove, canGenerate } from "../viewmodels/review";

/** Literal complete Markdown panels: no HTML or Markdown rendering of model text. */
export function mountReviewView(el: HTMLElement, controller: ReviewController, close: () => void): Disposable {
  el.classList.add("syn-review");
  const doc = el.ownerDocument;
  let disposed = false;
  function add<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text = "", cls = ""): HTMLElementTagNameMap[K] {
    const child = doc.createElement(tag);
    child.textContent = text;
    if (cls) child.className = `syn-${cls}`;
    parent.append(child);
    return child;
  }
  function paint(): void {
    if (disposed) return;
    const focused = el.contains(doc.activeElement) ? doc.activeElement?.getAttribute("data-syn-focus") : null;
    const state = controller.state.get();
    el.replaceChildren();
    add(el, "h2", REVIEW.title);
    add(el, "p", REVIEW.milestone);
    add(el, "p", REVIEW.disclosure);
    const status = add(el, "p", REVIEW.phase[state.phase]);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    if (state.phase === "selecting") {
      const group = add(el, "fieldset");
      add(group, "legend", REVIEW.destinations);
      const destinations = [...state.routing.destinations.map((d) => ({ id: d.id, label: d.path })),
        { id: state.routing.daily.id, label: REVIEW.daily(state.routing.daily.folder, state.routing.timezone) }];
      for (const [index, destination] of destinations.entries()) {
        const label = add(group, "label", "", "review-choice");
        const input = add(label, "input"); input.type = "checkbox"; input.setAttribute("data-syn-focus", `destination-${index}`);
        input.checked = state.destinations.includes(destination.id);
        add(label, "span", destination.label);
        input.addEventListener("change", () => {
          if (disposed) return;
          controller.choices(input.checked ? [...state.destinations, destination.id] : state.destinations.filter((id) => id !== destination.id), state.dailyDate);
        });
      }
      const label = add(group, "label", REVIEW.dailyDate);
      const date = add(label, "input"); date.type = "date"; date.setAttribute("data-syn-focus", "date"); date.value = state.dailyDate;
      date.addEventListener("change", () => { if (!disposed) controller.choices(state.destinations, date.value); });
      const generate = add(el, "button", REVIEW.generate); generate.type = "button"; generate.disabled = !canGenerate(state);
      generate.addEventListener("click", () => { if (!disposed) void controller.generate(); });
    }
    if (state.proposal) {
      const proposal = state.proposal;
      add(el, "p", REVIEW.provenance(proposal.batch.source, proposal.batch.provenance, proposal.batch.range.start, proposal.batch.range.end));
      if (proposal.issues.length) {
        add(el, "p", REVIEW.issues);
        for (const issue of proposal.issues) add(el, "p", issue.code);
      }
      proposal.changes.forEach((change, index) => {
        const row = add(el, "section", "", "review-change");
        add(row, "h3", change.path);
        add(row, "p", REVIEW.operation[change.operation]);
        add(row, "p", REVIEW.evidence(change.evidenceIds));
        const diff = add(row, "div", "", "review-diff");
        for (const [heading, text] of [[REVIEW.before, change.before], [REVIEW.after, change.after]]) {
          const panel = add(diff, "section");
          add(panel, "h4", heading);
          add(panel, "pre", text, "review-markdown");
        }
        const label = add(row, "label", change.path);
        const select = add(label, "select");
        for (const [value, text] of [["undecided", REVIEW.undecided], ["accept", REVIEW.accept], ["reject", REVIEW.reject]]) {
          const option = add(select, "option", text); option.value = value;
        }
        select.setAttribute("data-syn-focus", `decision-${index}`);
        select.value = state.decisions[index]; select.disabled = state.phase !== "review";
        select.addEventListener("change", () => {
          if (!disposed && ["undecided", "accept", "reject"].includes(select.value)) controller.decide(index, select.value as "undecided" | "accept" | "reject");
        });
      });
      const approve = add(el, "button", REVIEW.approve); approve.type = "button"; approve.disabled = !canApprove(state);
      approve.addEventListener("click", () => { if (!disposed) void controller.approve(); });
    }
    if (state.phase === "approved") {
      const apply = add(el, "button", REVIEW.apply); apply.type = "button";
      apply.addEventListener("click", () => { if (!disposed) void controller.apply(); });
    }
    if (state.report) for (const outcome of state.report.outcomes) add(el, "p", `${outcome.path}: ${REVIEW.outcome[outcome.status]}`);
    const cancel = add(el, "button", REVIEW.cancel); cancel.type = "button";
    cancel.addEventListener("click", () => { if (!disposed) close(); });
    if (focused) el.querySelector<HTMLElement>(`[data-syn-focus="${focused}"]`)?.focus();
  }
  paint();
  const unsubscribe = controller.state.subscribe(paint);
  return () => { disposed = true; unsubscribe(); el.replaceChildren(); el.classList.remove("syn-review"); };
}
