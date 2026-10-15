import { err, hashApprovalBinding, ok, synapseError, type Approval, type ApprovalBinding, type ChangeProposal, type ControlPaths, type Result } from "../core";
import { parseChangeProposal } from "./contracts";

export type ReviewDecision = "undecided" | "accept" | "reject";
export interface ReviewApproval {
  approve(decisions: readonly ReviewDecision[]): Promise<Result<Approval>>;
  /** Identity-checked and single-use. Serialized approval data is never authority. */
  consume(approval: Approval): Promise<Result<ApprovalBinding>>;
  invalidate(): void;
}
function refused(): Result<never> {
  return err(synapseError({ code: "SCHEMA_INVALID", message: "Review unavailable", detail: { issueCode: "REVIEW_STALE_OR_INVALID" } }));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Only the local review controller receives this capability. No parser issues it. */
export function createReviewApproval(deps: {
  proposal: ChangeProposal;
  paths: ControlPaths;
  /** Rechecks source, target, controls, editor and permission through read ports. */
  validate(): Promise<boolean>;
  /** Synchronous host/source generation, including changes during async hashing. */
  version(): string;
}): ReviewApproval {
  const parsed = parseChangeProposal(deps.proposal, deps.paths);
  const proposal = parsed.ok ? freeze(structuredClone(parsed.value)) : null;
  const version = deps.version();
  let invalid = false;
  let busy = false;
  let issued: { approval: Approval; binding: ApprovalBinding } | null = null;
  const current = () => !invalid && deps.version() === version;
  async function fresh(): Promise<boolean> {
    try { return current() && await deps.validate() && current(); } catch { return false; }
  }
  return {
    async approve(decisions) {
      if (busy || !current() || !proposal || proposal.issues.length || decisions.length !== proposal.changes.length
        || decisions.some((d) => d !== "accept" && d !== "reject") || !decisions.includes("accept")) return refused();
      // Snapshot decisions before the first asynchronous boundary.
      const changes = proposal.changes.filter((_, i) => decisions[i] === "accept");
      busy = true;
      issued = null;
      try {
        if (!await fresh()) { invalid = true; return refused(); }
        const binding = freeze({ version: 1 as const, proposalId: proposal.id, batch: proposal.batch,
          instructionsHash: proposal.instructionsHash, policyHash: proposal.policyHash, changes });
        const hash = await hashApprovalBinding(binding);
        if (!hash.ok || !await fresh()) { invalid = true; return refused(); }
        const approval = Object.freeze({ id: crypto.randomUUID(), bindingHash: hash.value, issuedBy: "local-ui" as const });
        if (!current()) return refused();
        issued = { approval, binding };
        return ok(approval);
      } catch { invalid = true; return refused(); } finally { busy = false; }
    },
    async consume(approval) {
      if (busy || !issued || issued.approval !== approval || !current()) return refused();
      const binding = issued.binding;
      issued = null; // Burn before awaiting: concurrent consumption cannot replay.
      busy = true;
      try {
        if (!await fresh()) { invalid = true; return refused(); }
        return ok(binding);
      } finally { busy = false; }
    },
    invalidate() { invalid = true; issued = null; },
  };
}
