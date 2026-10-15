import { CONTROL_LIMITS, RESEARCH_LEDGER_MAX_RECORDS } from "../constants";
import { contentHash, err, ok, stableStringify, synapseError, validateControlPaths, type ActiveNotePort, type BatchId, type Clock, type ControlPaths, type ResearchBatch, type ResearchLedger, type ResearchLedgerRecord, type ResearchProcessingState, type Result, type VaultPort } from "../core";

export interface ResearchSnapshot {
  readonly batch: ResearchBatch;
  /** In-memory untrusted material. Never persisted or treated as operational instructions. */
  readonly text: string;
}
export interface ResearchCapture {
  readonly snapshot: ResearchSnapshot;
  readonly duplicate: boolean;
  readonly outcome: ResearchProcessingState;
}
export interface ResearchInbox {
  capture(): Promise<Result<ResearchCapture>>;
  validateSnapshot(snapshot: ResearchSnapshot): Promise<Result<void>>;
  markProposed(snapshot: ResearchSnapshot): Promise<Result<void>>;
  ledgerStatus(id: BatchId): Result<{ readonly outcome: ResearchProcessingState; readonly conflicted: boolean }>;
  dispose(): void;
}
export interface ResearchInboxDeps {
  readonly vault: VaultPort;
  readonly activeNote: ActiveNotePort;
  readonly clock: Clock;
  readonly paths: ControlPaths;
  readonly readLedger: () => ResearchLedger;
  /** Trusted plugin-state callback, never a vault writer. Must resolve only after flush. */
  readonly saveLedger: (ledger: ResearchLedger) => Promise<void>;
}

function failure(code: string): Result<never> {
  return err(synapseError({ code: code === "RESEARCH_STORAGE_FAILED" ? "STORAGE_WRITE_FAILED" : code === "RESEARCH_CANCELLED" ? "CANCELLED" : "TOOL_ARGS_INVALID", message: "Research capture unavailable", detail: { issueCode: code } }));
}
/** UTF-16 ranges may not bisect a Unicode scalar before UTF-8 hashing. */
function splitsSurrogatePair(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length && text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff;
}
function outcome(record: ResearchLedgerRecord): ResearchProcessingState {
  for (const state of ["applied", "partially-applied", "rejected", "proposed", "captured"] as const) if (record.outcomes.includes(state)) return state;
  return "captured";
}

/** Privileged local selection capture. Does not grant remote disclosure or note application. */
export function createResearchInbox(deps: ResearchInboxDeps): ResearchInbox {
  const { vault, activeNote, paths } = deps;
  const validPaths = validateControlPaths(paths);
  let epoch = 0;
  let disposed = false;
  let tail: Promise<void> = Promise.resolve();
  const snapshots = new WeakMap<ResearchSnapshot, number>();
  const isInbox = (path: string): boolean => path.toLowerCase() === paths.research.toLowerCase();
  const unsubscribeVault = vault.onChange((event) => {
    if (event.type === "rename" ? isInbox(event.from) || isInbox(event.to) : isInbox(event.path)) ++epoch;
  });
  const unsubscribeEditor = activeNote.onActivity((event) => { if (event.type === "edit" && isInbox(event.path)) ++epoch; });

  const current = (generation: number): boolean => !disposed && generation === epoch;
  function ledgerAvailable(): Result<ResearchLedger> {
    const ledger = deps.readLedger();
    return ledger.blocked ? failure("RESEARCH_LEDGER_BLOCKED") : ok(ledger);
  }
  async function readSource(): Promise<Result<string>> {
    if (!validPaths.ok) return failure("RESEARCH_INVALID_SOURCE");
    const files = await vault.listFiles();
    const matches = files.filter((file) => isInbox(file.path));
    if (!matches.length) return failure("RESEARCH_MISSING");
    if (matches.length !== 1 || matches[0].path !== paths.research || matches[0].kind !== "note") return failure("RESEARCH_INVALID_SOURCE");
    return ok(await vault.readText(paths.research));
  }
  function editorMatches(text: string): boolean {
    const editor = activeNote.current();
    // If focus moved away, vault events/disk still protect the snapshot. No buffer is assumed saved.
    return editor === null || editor.path !== paths.research || editor.text === text;
  }
  async function captureSelection(selected: ReturnType<ActiveNotePort["current"]>, generation: number): Promise<Result<ResearchCapture>> {
    try {
      if (!current(generation)) return failure(disposed ? "RESEARCH_CANCELLED" : "RESEARCH_STALE");
      if (!validPaths.ok || !selected || selected.path !== paths.research) return failure("RESEARCH_INVALID_SOURCE");
      const range = selected.selection;
      if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > selected.text.length || splitsSurrogatePair(selected.text, range.start) || splitsSurrogatePair(selected.text, range.end) || !selected.text.slice(range.start, range.end).trim()) return failure("RESEARCH_SELECTION_REQUIRED");
      if (range.end - range.start > CONTROL_LIMITS.markdownChars) return failure("RESEARCH_SELECTION_TOO_LARGE");
      const ledger = ledgerAvailable();
      if (!ledger.ok) return ledger;
      const read = await readSource();
      if (!read.ok) return read;
      if (!current(generation)) return failure(disposed ? "RESEARCH_CANCELLED" : "RESEARCH_STALE");
      if (read.value !== selected.text || !editorMatches(read.value)) return failure("RESEARCH_DIRTY");
      const text = read.value.slice(range.start, range.end);
      const sourceHash = await contentHash(read.value);
      const selectedHash = await contentHash(text);
      if (!sourceHash.ok) return sourceHash;
      if (!selectedHash.ok) return selectedHash;
      const identity = await contentHash(stableStringify({ source: paths.research, selectedHash: selectedHash.value }));
      if (!identity.ok) return identity;
      const batch: ResearchBatch = Object.freeze({ id: identity.value as unknown as BatchId, source: paths.research, sourceHash: sourceHash.value, selectedHash: selectedHash.value, range: Object.freeze({ ...range }), provenance: "local" });
      const recheck = await readSource();
      if (!recheck.ok) return recheck;
      if (!current(generation) || recheck.value !== read.value || !editorMatches(read.value)) return failure(disposed ? "RESEARCH_CANCELLED" : "RESEARCH_STALE");
      const latest = ledgerAvailable();
      if (!latest.ok) return latest;
      const previous = latest.value.records.find((record) => record.batch.id === batch.id);
      if (previous && (previous.conflicted || previous.batch.source !== batch.source || previous.batch.selectedHash !== batch.selectedHash || previous.batch.provenance !== batch.provenance)) return failure("RESEARCH_LEDGER_CONFLICT");
      if (!previous && latest.value.records.length >= RESEARCH_LEDGER_MAX_RECORDS) return failure("RESEARCH_LEDGER_FULL");
      const now = Math.max(0, Math.trunc(deps.clock.now()));
      if (!Number.isSafeInteger(now)) return failure("RESEARCH_UNAVAILABLE");
      const record: ResearchLedgerRecord = previous
        ? { ...previous, batch, lastCapturedAt: Math.max(now, previous.lastCapturedAt) }
        : { batch, firstCapturedAt: now, lastCapturedAt: now, outcomes: ["captured"], conflicted: false };
      try {
        await deps.saveLedger({ version: 1, blocked: false, records: [...latest.value.records.filter((item) => item.batch.id !== batch.id), record].sort((a, b) => a.batch.id.localeCompare(b.batch.id)) });
      } catch { return failure("RESEARCH_STORAGE_FAILED"); }
      const finalRead = await readSource();
      if (!finalRead.ok) return finalRead;
      if (!current(generation) || finalRead.value !== read.value || !editorMatches(read.value)) return failure(disposed ? "RESEARCH_CANCELLED" : "RESEARCH_STALE");
      const status = ledgerStatus(batch.id);
      if (!status.ok) return status;
      if (status.value.conflicted) return failure("RESEARCH_LEDGER_CONFLICT");
      const snapshot = Object.freeze({ batch, text });
      snapshots.set(snapshot, generation);
      return ok({ snapshot, duplicate: previous !== undefined, outcome: status.value.outcome });
    } catch { return failure("RESEARCH_UNAVAILABLE"); }
  }
  function ledgerStatus(id: BatchId): Result<{ readonly outcome: ResearchProcessingState; readonly conflicted: boolean }> {
    if (disposed) return failure("RESEARCH_CANCELLED");
    const ledger = ledgerAvailable();
    if (!ledger.ok) return ledger;
    const record = ledger.value.records.find((item) => item.batch.id === id);
    return record ? ok({ outcome: outcome(record), conflicted: record.conflicted }) : failure("RESEARCH_MISSING_BATCH");
  }
  const inbox: ResearchInbox = {
    capture() {
      // Copy the user's explicit selection now, before queued I/O or mutable editor state changes.
      let selected: ReturnType<ActiveNotePort["current"]>;
      try {
        const active = activeNote.current();
        selected = active ? { ...active, ...(active.selection ? { selection: { ...active.selection } } : {}) } : null;
      } catch { return Promise.resolve(failure("RESEARCH_UNAVAILABLE")); }
      const generation = epoch;
      const run = tail.then(() => captureSelection(selected, generation));
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    async validateSnapshot(snapshot) {
      try {
        const generation = snapshots.get(snapshot);
        if (generation === undefined || !current(generation)) return failure(disposed ? "RESEARCH_CANCELLED" : "RESEARCH_STALE");
        const read = await readSource();
        if (!read.ok) return read;
        const hash = await contentHash(read.value);
        if (!hash.ok) return hash;
        if (!current(generation) || hash.value !== snapshot.batch.sourceHash || !editorMatches(read.value)) return failure("RESEARCH_STALE");
        const status = ledgerStatus(snapshot.batch.id);
        if (!status.ok) return status;
        return status.value.conflicted ? failure("RESEARCH_LEDGER_CONFLICT") : ok(undefined);
      } catch { return failure("RESEARCH_UNAVAILABLE"); }
    },
    markProposed(snapshot) {
      const run = tail.then(async (): Promise<Result<void>> => {
        const valid = await inbox.validateSnapshot(snapshot);
        if (!valid.ok) return valid;
        const latest = ledgerAvailable();
        if (!latest.ok) return latest;
        const record = latest.value.records.find((item) => item.batch.id === snapshot.batch.id);
        if (!record || record.conflicted || record.outcomes.some((state) => state === "applied" || state === "partially-applied" || state === "rejected")) return failure("RESEARCH_LEDGER_CONFLICT");
        try {
          await deps.saveLedger({ ...latest.value, records: latest.value.records.map((item) => item === record ? { ...item, outcomes: item.outcomes.includes("proposed") ? item.outcomes : [...item.outcomes, "proposed"] } : item) });
        } catch { return failure("RESEARCH_STORAGE_FAILED"); }
        return inbox.validateSnapshot(snapshot);
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    ledgerStatus,
    dispose() { if (disposed) return; disposed = true; ++epoch; unsubscribeVault(); unsubscribeEditor(); },
  };
  return inbox;
}
