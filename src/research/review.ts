import { applyReviewedChanges, createReviewApproval, type ReviewApproval, type ReviewDecision, type RecoveryJournal } from "../changes";
import { contentHash, err, ok, synapseError, type Approval, type ApplyReport, type NoteWritePort, type ProposedChange, type ChangeProposal, type Disposable, type Result, type RoutingSettings } from "../core";
import { evaluateAccessContract, evaluateResearchInput } from "../policy";
import { createProposalGenerator, type GeneratedProposal, type ProposalGeneratorDeps } from "./proposals";
import type { ResearchSnapshot } from "./inbox";
import type { JobHandle } from "../jobs";

export interface ResearchReviewSession {
  readyProposal?(): ChangeProposal | null;
  prepare(): Promise<Result<RoutingSettings>>;
  generate(destinations: readonly string[], dailyDate?: string): JobHandle<GeneratedProposal> | null;
  approve(decisions: readonly ReviewDecision[]): Promise<Result<Approval>>;
  apply(approval: Approval): Promise<Result<ApplyReport>>;
  onInvalidate(callback: () => void): Disposable;
  dispose(): void;
}
const unavailable = (): Result<never> => err(synapseError({ code: "SCHEMA_INVALID", message: "Research review unavailable" }));
/** One local review lifecycle; approval authority stays in memory. Accepted bodies
 * enter bounded recovery storage only when local Apply consumes authority. */
export function createResearchReviewSession(deps: ProposalGeneratorDeps & { writer?: NoteWritePort; journal: RecoveryJournal; revertId?: string; subscribeSettings(callback: () => void): Disposable; subscribeControls(callback: () => void): Disposable }): ResearchReviewSession {
  const generator = createProposalGenerator(deps);
  let snapshot: ResearchSnapshot | null = null;
  let proposal: ChangeProposal | null = null;
  let approval: ReviewApproval | null = null;
  let disposed = false;
  let verifiedEditors: { path: string; text: string }[] = [];
  let applying = false;
  let committingPath: string | null = null;
  const abort = new AbortController();
  const completed = new Map<string, ProposedChange>();
  let epoch = 0;
  let handle: JobHandle<GeneratedProposal> | null = null;
  const listeners = new Set<() => void>();
  function invalidate(): void {
    ++epoch;
    approval?.invalidate();
    approval = null;
    proposal = null;
    verifiedEditors = [];
    if (!applying) completed.clear();
    handle?.cancel();
    for (const callback of listeners) callback();
  }
  const applyingTarget = (path: string) => applying && committingPath === path;
  const unsubscribers = [deps.vault.onChange((event) => {
    if (event.type !== "rename" && (event.type === "modify" || event.type === "create") && applyingTarget(event.path)) return;
    invalidate();
  }), deps.metadata.onChanged((path) => { if (!applyingTarget(path)) invalidate(); }), deps.metadata.onResolved(() => { if (!applying) invalidate(); }),
    deps.activeNote.onActivity((event) => { if (event.type === "edit") invalidate(); }),
    deps.subscribeSettings(invalidate), deps.subscribeControls(invalidate)];
  const version = () => `${epoch}:${deps.version()}`;
  async function validate(): Promise<boolean> {
    const editors: { path: string; text: string }[] = [];
    const captured = snapshot;
    const reviewed = proposal;
    if (disposed || !reviewed || (!deps.revertId && (!captured || !(await deps.inbox.validateSnapshot(captured)).ok))) return false;
    const controls = deps.controls();
    if (!controls || controls.instructions.hash !== reviewed.instructionsHash || controls.policy.hash !== reviewed.policyHash) return false;
    if (!deps.revertId && captured) {
      const ledger = deps.inbox.ledgerStatus(captured.batch.id);
      if (!ledger.ok || ledger.value.conflicted || (ledger.value.outcome !== "proposed" && !(applying && ledger.value.outcome === "partially-applied"))) return false;
    }
    const sourceText = await deps.vault.readText(deps.paths.research);
    const sourceHash = await contentHash(sourceText);
    if (!sourceHash.ok || sourceHash.value !== reviewed.batch.sourceHash) return false;
    editors.push({ path: deps.paths.research, text: sourceText });
    const files = await deps.vault.listFiles();
    for (const kind of ["instructions", "security"] as const) {
      const path = deps.paths[kind];
      const matches = files.filter((file) => file.path.toLowerCase() === path.toLowerCase());
      if (matches.length !== 1 || matches[0].path !== path || matches[0].kind !== "note") return false;
      const text = await deps.vault.readText(path);
      editors.push({ path, text });
      const hash = await contentHash(text);
      const expected = kind === "instructions" ? controls.instructions.hash : controls.policy.hash;
      const editor = deps.activeNote.current();
      if (!hash.ok || hash.value !== expected || (editor?.path === path && editor.text !== text)) return false;
    }
    const readable = (path: typeof deps.paths.research, privileged: boolean) => {
      const metadata = deps.metadata.get(path);
      const evaluate = privileged ? evaluateResearchInput : evaluateAccessContract;
      return evaluate(controls.policy, { context: { recipient: "internal", purpose: "research", policyHash: controls.policy.hash },
        operation: "read", path, tags: metadata?.tags ?? null, frontmatter: metadata?.frontmatter ?? null,
        excluded: deps.exclusion.decide(path, metadata?.tags ?? null, metadata?.frontmatter ?? null) === "excluded", controlPaths: deps.paths, maskingSupported: false }).effect === "allow";
    };
    if (!readable(deps.paths.research, true) || !readable(deps.paths.instructions, true)) return false;
    for (const change of reviewed.changes) {
      const applied = completed.get(change.path);
      const expectedExists = change.target.exists || !!applied;
      const expectedText = applied ? change.after : change.before;
      const matches = files.filter((file) => file.path.toLowerCase() === change.path.toLowerCase());
      if (expectedExists ? matches.length !== 1 || matches[0].path !== change.path || matches[0].kind !== "note" : matches.length !== 0) return false;
      const text = expectedExists ? await deps.vault.readText(change.path) : "";
      editors.push({ path: change.path, text: expectedText });
      if (text !== expectedText || (expectedExists && !readable(change.path, false))) return false;
      if (change.target.exists && !applied) { const hash = await contentHash(text); if (!hash.ok || hash.value !== change.target.hash) return false; }
      const editor = deps.activeNote.current();
      if (editor?.path === change.path && editor.text !== text) return false;
      const metadata = expectedExists ? deps.metadata.get(change.path) : { tags: [], frontmatter: {} };
      const access = evaluateAccessContract(controls.policy, { context: { recipient: "internal", purpose: "apply", policyHash: controls.policy.hash },
        operation: change.operation, path: change.path, tags: metadata?.tags ?? null, frontmatter: metadata?.frontmatter ?? null,
        excluded: deps.exclusion.decide(change.path, metadata?.tags ?? null, metadata?.frontmatter ?? null) === "excluded", controlPaths: deps.paths, maskingSupported: false });
      if (access.effect !== "allow") return false;
    }
    verifiedEditors = editors;
    return !disposed;
  }
  return {
    readyProposal: () => deps.revertId ? proposal : null,
    async prepare() {
      if (disposed || snapshot) return unavailable();
      const generation = version();
      if (deps.revertId) {
        const controls = deps.controls();
        if (!controls || !deps.journal) return unavailable();
        const reverted = await deps.journal.revert(deps.revertId, deps.paths, controls.instructions.hash, controls.policy.hash);
        if (!reverted.ok || disposed || generation !== version()) return unavailable();
        const source = await deps.vault.readText(deps.paths.research);
        const hash = await contentHash(source);
        if (!hash.ok || disposed || generation !== version()) return unavailable();
        // Bind a new source snapshot; original provenance/range remains historical.
        proposal = { ...reverted.value, batch: { ...reverted.value.batch, sourceHash: hash.value } };
        if (!await validate() || disposed || generation !== version()) { proposal = null; return unavailable(); }
        approval = createReviewApproval({ proposal, paths: deps.paths, version, validate });
        return ok(structuredClone(controls.instructions.routing));
      }
      const recovered = await deps.journal.reconcile();
      if (recovered && !recovered.ok) return unavailable();
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
    async apply(token) {
      const authority = approval;
      if (disposed || applying || !authority || !deps.writer) return unavailable();
      applying = true;
      const generation = version();
      try {
        const result = await applyReviewedChanges({ authority, approval: token, writer: deps.writer, paths: deps.paths, signal: abort.signal,
          current: () => !disposed && generation === version(), validate, editorSnapshots: () => verifiedEditors,
          journal: deps.journal,
          ...(deps.revertId ? { parent: deps.revertId } : {}),
          begin: () => deps.revertId ? Promise.resolve(ok(undefined)) : snapshot ? deps.inbox.markApplication(snapshot, "partially-applied") : Promise.resolve(unavailable()),
          willCommit: (change) => { committingPath = change.path; },
          completed: (change) => { completed.set(change.path, change); committingPath = null; } });
        if (!deps.revertId && result.ok && snapshot && result.value.outcomes.every((outcome) => outcome.status === "applied")) await deps.inbox.markApplication(snapshot, "applied");
        return result;
      } finally { committingPath = null; applying = false; invalidate(); }
    },
    onInvalidate(callback) { if (disposed) return () => {}; listeners.add(callback); return () => { listeners.delete(callback); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      invalidate();
      listeners.clear();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      generator.dispose();
      snapshot = null;
      proposal = null;
      completed.clear();
      verifiedEditors = [];
    },
  };
}
