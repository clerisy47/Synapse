import { createReviewApproval, type ReviewApproval, type ReviewDecision } from "../changes";
import { contentHash, err, ok, synapseError, type Approval, type ChangeProposal, type Disposable, type Result, type RoutingSettings } from "../core";
import { evaluateAccessContract, evaluateResearchInput } from "../policy";
import { createProposalGenerator, type GeneratedProposal, type ProposalGeneratorDeps } from "./proposals";
import type { ResearchSnapshot } from "./inbox";
import type { JobHandle } from "../jobs";

export interface ResearchReviewSession {
  prepare(): Promise<Result<RoutingSettings>>;
  generate(destinations: readonly string[], dailyDate?: string): JobHandle<GeneratedProposal> | null;
  approve(decisions: readonly ReviewDecision[]): Promise<Result<Approval>>;
  onInvalidate(callback: () => void): Disposable;
  dispose(): void;
}
const unavailable = (): Result<never> => err(synapseError({ code: "SCHEMA_INVALID", message: "Research review unavailable" }));
/** One local review lifecycle; all bodies and approval authority stay in memory. */
export function createResearchReviewSession(deps: ProposalGeneratorDeps & { subscribeSettings(callback: () => void): Disposable; subscribeControls(callback: () => void): Disposable }): ResearchReviewSession {
  const generator = createProposalGenerator(deps);
  let snapshot: ResearchSnapshot | null = null;
  let proposal: ChangeProposal | null = null;
  let approval: ReviewApproval | null = null;
  let disposed = false;
  let epoch = 0;
  let handle: JobHandle<GeneratedProposal> | null = null;
  const listeners = new Set<() => void>();
  function invalidate(): void {
    ++epoch;
    approval?.invalidate();
    approval = null;
    proposal = null;
    handle?.cancel();
    for (const callback of listeners) callback();
  }
  const unsubscribers = [deps.vault.onChange(invalidate), deps.metadata.onChanged(invalidate), deps.metadata.onResolved(invalidate),
    deps.activeNote.onActivity((event) => { if (event.type === "edit") invalidate(); }),
    deps.subscribeSettings(invalidate), deps.subscribeControls(invalidate)];
  const version = () => `${epoch}:${deps.version()}`;
  async function validate(): Promise<boolean> {
    const captured = snapshot;
    const reviewed = proposal;
    if (disposed || !captured || !reviewed || !(await deps.inbox.validateSnapshot(captured)).ok) return false;
    const controls = deps.controls();
    if (!controls || controls.instructions.hash !== reviewed.instructionsHash || controls.policy.hash !== reviewed.policyHash) return false;
    const ledger = deps.inbox.ledgerStatus(captured.batch.id);
    if (!ledger.ok || ledger.value.conflicted || ledger.value.outcome !== "proposed") return false;
    const readable = (path: typeof deps.paths.research, privileged: boolean) => {
      const metadata = deps.metadata.get(path);
      const evaluate = privileged ? evaluateResearchInput : evaluateAccessContract;
      return evaluate(controls.policy, { context: { recipient: "internal", purpose: "research", policyHash: controls.policy.hash },
        operation: "read", path, tags: metadata?.tags ?? null, frontmatter: metadata?.frontmatter ?? null,
        excluded: deps.exclusion.decide(path, metadata?.tags ?? null, metadata?.frontmatter ?? null) === "excluded", controlPaths: deps.paths, maskingSupported: false }).effect === "allow";
    };
    if (!readable(deps.paths.research, true) || !readable(deps.paths.instructions, true)) return false;
    const files = await deps.vault.listFiles();
    for (const change of reviewed.changes) {
      const matches = files.filter((file) => file.path.toLowerCase() === change.path.toLowerCase());
      if (change.target.exists ? matches.length !== 1 || matches[0].path !== change.path || matches[0].kind !== "note" : matches.length !== 0) return false;
      const text = change.target.exists ? await deps.vault.readText(change.path) : "";
      if (text !== change.before || (change.target.exists && !readable(change.path, false))) return false;
      if (change.target.exists) { const hash = await contentHash(text); if (!hash.ok || hash.value !== change.target.hash) return false; }
      const editor = deps.activeNote.current();
      if (editor?.path === change.path && editor.text !== text) return false;
      const metadata = change.target.exists ? deps.metadata.get(change.path) : { tags: [], frontmatter: {} };
      const access = evaluateAccessContract(controls.policy, { context: { recipient: "internal", purpose: "apply", policyHash: controls.policy.hash },
        operation: change.operation, path: change.path, tags: metadata?.tags ?? null, frontmatter: metadata?.frontmatter ?? null,
        excluded: deps.exclusion.decide(change.path, metadata?.tags ?? null, metadata?.frontmatter ?? null) === "excluded", controlPaths: deps.paths, maskingSupported: false });
      if (access.effect !== "allow") return false;
    }
    return !disposed;
  }
  return {
    async prepare() {
      if (disposed || snapshot) return unavailable();
      const generation = version();
      const captured = await deps.inbox.capture();
      const controls = deps.controls();
      if (!captured.ok) return captured;
      if (disposed || generation !== version() || !controls) return unavailable();
      snapshot = captured.value.snapshot;
      return ok(structuredClone(controls.instructions.routing));
    },
    generate(destinations, dailyDate) {
      if (disposed || !snapshot) return null;
      invalidate();
      proposal = null;
      const generation = version();
      handle = generator.generate({ snapshot, destinations, ...(dailyDate === undefined ? {} : { dailyDate }) });
      const pending = handle;
      // Registered before the controller's result listener, so approval is ready first.
      void pending.result.then((result) => {
        if (disposed || pending !== handle || generation !== version() || !result.ok) return;
        proposal = result.value.proposal;
        approval = createReviewApproval({ proposal, paths: deps.paths, version, validate });
      });
      return handle;
    },
    async approve(decisions) { return approval ? approval.approve(decisions) : unavailable(); },
    onInvalidate(callback) { if (disposed) return () => {}; listeners.add(callback); return () => { listeners.delete(callback); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      listeners.clear();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      generator.dispose();
      snapshot = null;
      proposal = null;
    },
  };
}
