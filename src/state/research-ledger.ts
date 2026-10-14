import { z } from "zod";
import { CONTROL_LIMITS, RESEARCH_LEDGER_MAX_RECORDS } from "../constants";
import { stableStringify, validateVaultPath, type BatchId, type ContentHash, type ResearchLedger, type ResearchLedgerRecord, type ResearchProcessingState } from "../core";

const hash = z.string().regex(/^[a-f0-9]{64}$/).transform((value) => value as ContentHash);
const path = z.string().max(CONTROL_LIMITS.pathChars).transform((value, ctx) => {
  const parsed = validateVaultPath(value);
  if (!parsed.ok || parsed.value !== value) { ctx.addIssue({ code: "custom", message: "INVALID_RESEARCH_PATH" }); return z.NEVER; }
  return parsed.value;
});
const outcomes: readonly ResearchProcessingState[] = ["captured", "proposed", "rejected", "partially-applied", "applied"];
const recordSchema = z.strictObject({
  batch: z.strictObject({
    id: z.string().regex(/^[a-f0-9]{64}$/).transform((value) => value as BatchId), source: path,
    sourceHash: hash, selectedHash: hash,
    range: z.strictObject({ start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), end: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).refine((value) => value.end > value.start && value.end - value.start <= CONTROL_LIMITS.markdownChars),
    provenance: z.enum(["local", "external"]),
  }),
  firstCapturedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastCapturedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  outcomes: z.array(z.enum(["captured", "proposed", "rejected", "partially-applied", "applied"])).min(1).max(outcomes.length).refine((value) => new Set(value).size === value.length && value.includes("captured")),
  conflicted: z.boolean(),
}).refine((value) => value.lastCapturedAt >= value.firstCapturedAt);
const ledgerSchema = z.strictObject({ version: z.literal(1), blocked: z.boolean(), records: z.array(recordSchema).max(RESEARCH_LEDGER_MAX_RECORDS) });

export function emptyResearchLedger(): ResearchLedger { return { version: 1, blocked: false, records: [] }; }

/** Invalid known state must never be normalized into an apparently fresh inbox. */
export function parseResearchLedger(raw: unknown): ResearchLedger {
  if (raw === undefined) return emptyResearchLedger();
  const parsed = ledgerSchema.safeParse(raw);
  if (!parsed.success) return { version: 1, blocked: true, records: [] };
  const records = parsed.data.records.map((record) => ({ ...record, outcomes: outcomes.filter((outcome) => record.outcomes.includes(outcome)), conflicted: record.conflicted || outcomeConflict(record.outcomes) }));
  if (new Set(records.map((record) => record.batch.id)).size !== records.length) return { version: 1, blocked: true, records: [] };
  return { version: 1, blocked: parsed.data.blocked, records: records.sort((a, b) => a.batch.id.localeCompare(b.batch.id)) };
}

function outcomeConflict(values: readonly ResearchProcessingState[]): boolean {
  return values.includes("rejected") && (values.includes("partially-applied") || values.includes("applied"));
}

/** Union history, never settings-timestamp LWW. Conflicts cannot erase write evidence. */
export function mergeResearchLedgers(a: ResearchLedger, b: ResearchLedger): ResearchLedger {
  const records = new Map<string, ResearchLedgerRecord>();
  for (const incoming of [...a.records, ...b.records]) {
    const previous = records.get(incoming.batch.id);
    if (!previous) { records.set(incoming.batch.id, incoming); continue; }
    const chosen = previous.lastCapturedAt > incoming.lastCapturedAt ? previous : incoming.lastCapturedAt > previous.lastCapturedAt ? incoming : stableStringify(previous.batch) >= stableStringify(incoming.batch) ? previous : incoming;
    const history = outcomes.filter((outcome) => previous.outcomes.includes(outcome) || incoming.outcomes.includes(outcome));
    records.set(incoming.batch.id, {
      batch: chosen.batch,
      firstCapturedAt: Math.min(previous.firstCapturedAt, incoming.firstCapturedAt), lastCapturedAt: Math.max(previous.lastCapturedAt, incoming.lastCapturedAt), outcomes: history,
      conflicted: previous.conflicted || incoming.conflicted || previous.batch.source !== incoming.batch.source || previous.batch.selectedHash !== incoming.batch.selectedHash || previous.batch.provenance !== incoming.batch.provenance || outcomeConflict(history),
    });
  }
  const sorted = [...records.values()].sort((left, right) => left.batch.id.localeCompare(right.batch.id));
  // Sync can union two individually full histories. Keep a deterministic bounded prefix,
  // and permanently block processing rather than present truncated history as complete.
  return cloneResearchLedger({ version: 1, blocked: a.blocked || b.blocked || sorted.length > RESEARCH_LEDGER_MAX_RECORDS, records: sorted.slice(0, RESEARCH_LEDGER_MAX_RECORDS) });
}

export function cloneResearchLedger(value: ResearchLedger): ResearchLedger {
  return { version: 1, blocked: value.blocked, records: value.records.map((record) => ({ ...record, batch: { ...record.batch, range: { ...record.batch.range } }, outcomes: [...record.outcomes] })) };
}
