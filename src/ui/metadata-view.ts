import type { Approval, ApplyReport, ChangeProposal, Disposable, MetadataIssue, Result, VaultPath } from "../core";
import type { JobHandle } from "../jobs";
import { METADATA } from "./strings/en";
interface RepairRunner {
  propose(): JobHandle<{ proposal: ChangeProposal }>;
  approve(decisions: readonly "accept"[]): Promise<Result<Approval>>;
  apply(token: Approval): Promise<Result<ApplyReport>>;
  onInvalidate(callback: () => void): Disposable;
  dispose(): void;
}
/** Local DOM only: counts/paths never enter MCP or the model. */
export function mountMetadataView(el: HTMLElement, deps: {
  repairs(): readonly { path: VaultPath; issues: readonly MetadataIssue[] }[];
  create(path: VaultPath): RepairRunner | null;
  close(): void;
}): Disposable {
  let disposed = false;
  let runner: RepairRunner | null = null;
  let unsub: Disposable | null = null;
  let generation = 0;
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string) => {
    const child = el.ownerDocument.createElement(tag); child.textContent = text;
    if (tag === "pre") child.className = "syn-review-markdown"; el.append(child); return child;
  };
  const button = (text: string, callback: () => void) => { const b = add("button", text); b.type = "button"; b.addEventListener("click", callback); return b; };
  const reset = () => { el.replaceChildren(); el.classList.add("syn-metadata", "syn-review"); add("h2", METADATA.title); };
  reset();
  add("p", METADATA.explanation); add("p", METADATA.guidance); add("p", METADATA.modelDisclosure);
  const repairs = deps.repairs(); add("p", METADATA.count(repairs.length));
  for (const item of repairs) {
    add("h3", item.path); add("p", item.issues.map((i) => `${i.field}: ${i.reason}`).join(", "));
    if (item.issues.every((i) => i.reason === "missing")) button(METADATA.propose, () => { void propose(item.path); });
  }
  button(METADATA.close, () => deps.close());
  async function propose(path: VaultPath) {
    if (disposed) return;
    runner?.dispose(); unsub?.();
    const active = deps.create(path); runner = active;
    reset();
    if (!active) { add("p", METADATA.failed); return; }
    const serial = ++generation;
    let applying = false;
    unsub = active.onInvalidate(() => { if (!disposed && !applying) { ++generation; reset(); add("p", METADATA.failed); } });
    add("p", METADATA.generating);
    const result = await active.propose().result;
    if (disposed || serial !== generation) return;
    reset();
    if (!result.ok) { add("p", METADATA.failed); return; }
    const c = result.value.proposal.changes[0];
    add("h3", c.path); add("h4", METADATA.before); add("pre", c.before); add("h4", METADATA.after); add("pre", c.after);
    const approve = button(METADATA.approve, () => { void (async () => {
      approve.disabled = true;
      const token = await active.approve(["accept"]);
      if (disposed || serial !== generation) return;
      if (!token.ok) { reset(); add("p", METADATA.failed); return; }
      const apply = button(METADATA.apply, () => { void (async () => {
        apply.disabled = true; applying = true;
        const report = await active.apply(token.value);
        if (disposed) return;
        reset(); add("p", report.ok && report.value.outcomes.every((o) => o.status === "applied") ? METADATA.applied : METADATA.refused);
        button(METADATA.close, () => deps.close());
      })(); });
    })(); });
    button(METADATA.close, () => deps.close());
  }
  return () => { disposed = true; ++generation; unsub?.(); runner?.dispose(); el.replaceChildren(); };
}
