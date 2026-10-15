import { ok, type Approval, type ApplyReport, type NoteWritePort, type ProposedChange, type Result } from "../core";
import type { RecoveryJournal } from "./recovery";
import type { ReviewApproval } from "./review";
import type { ControlPaths } from "../core";

/** Consumes local identity authority once; never accepts a parsed approval binding. */
export async function applyReviewedChanges(deps: {
  authority: ReviewApproval; approval: Approval; writer: NoteWritePort; paths: ControlPaths; signal: AbortSignal;
  current(): boolean;
  validate(): Promise<boolean>;
  editorSnapshots(): readonly { readonly path: string; readonly text: string }[];
  begin(): Promise<Result<void>>;
  journal: RecoveryJournal;
  parent?: string;
  willCommit(change: ProposedChange): void;
  completed(change: ProposedChange): void;
}): Promise<Result<ApplyReport>> {
  const consumed = await deps.authority.consume(deps.approval);
  if (!consumed.ok) return consumed;
  const started = await deps.begin();
  if (!started.ok) return started;
  const journaled = await deps.journal.begin(consumed.value, deps.parent);
  if (!journaled.ok) return journaled;
  const recoveryId = journaled.value;
  const outcomes: ApplyReport["outcomes"][number][] = [];
  let stopped = false;
  for (const [index, change] of consumed.value.changes.entries()) {
    if (stopped) { outcomes.push({ path: change.path, status: "not-attempted" }); continue; }
    try {
      if (recoveryId) {
        const intent = await deps.journal.outcome(recoveryId, index, "pending");
        if (!intent.ok) { outcomes.push({ path: change.path, status: "not-attempted" }); stopped = true; continue; }
      }
      const result = await deps.writer.apply({ change, paths: deps.paths, signal: deps.signal, current: () => deps.current(), revalidate: () => deps.validate(), willCommit: () => deps.willCommit(change), editorSnapshots: () => deps.editorSnapshots() });
      outcomes.push({ path: change.path, status: result.ok ? "applied" : result.error.detail?.issueCode === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "refused" });
      if (result.ok) deps.completed(change); else stopped = true;
      if (recoveryId) {
        const saved = await deps.journal.outcome(recoveryId, index, result.ok ? "applied" : result.error.detail?.issueCode === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "refused");
        if (!saved.ok) stopped = true;
      }
    } catch { outcomes.push({ path: change.path, status: "unknown" }); stopped = true; }
  }
  return ok({ outcomes, recoveryId });
}
