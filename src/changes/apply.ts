import { ok, type Approval, type ApplyReport, type NoteWritePort, type ProposedChange, type Result } from "../core";
import type { ReviewApproval } from "./review";
import type { ControlPaths } from "../core";

/** Consumes local identity authority once; never accepts a parsed approval binding. */
export async function applyReviewedChanges(deps: {
  authority: ReviewApproval; approval: Approval; writer: NoteWritePort; paths: ControlPaths; signal: AbortSignal;
  current(): boolean;
  validate(): Promise<boolean>;
  editorSnapshots(): readonly { readonly path: string; readonly text: string }[];
  begin(): Promise<Result<void>>;
  willCommit(change: ProposedChange): void;
  completed(change: ProposedChange): void;
}): Promise<Result<ApplyReport>> {
  const consumed = await deps.authority.consume(deps.approval);
  if (!consumed.ok) return consumed;
  const started = await deps.begin();
  if (!started.ok) return started;
  const outcomes: ApplyReport["outcomes"][number][] = [];
  let stopped = false;
  for (const change of consumed.value.changes) {
    if (stopped) { outcomes.push({ path: change.path, status: "not-attempted" }); continue; }
    try {
      const result = await deps.writer.apply({ change, paths: deps.paths, signal: deps.signal, current: () => deps.current(), revalidate: () => deps.validate(), willCommit: () => deps.willCommit(change), editorSnapshots: () => deps.editorSnapshots() });
      outcomes.push({ path: change.path, status: result.ok ? "applied" : result.error.detail?.issueCode === "WRITE_OUTCOME_UNKNOWN" ? "unknown" : "refused" });
      if (result.ok) deps.completed(change); else stopped = true;
    } catch { outcomes.push({ path: change.path, status: "unknown" }); stopped = true; }
  }
  return ok({ outcomes });
}
