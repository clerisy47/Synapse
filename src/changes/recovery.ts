import { z } from "zod";
import { RECOVERY_LIMITS } from "../constants";
import { contentHash, err, hashApprovalBinding, ok, stableStringify, synapseError, type ApprovalBinding, type ApplyReport, type ChangeProposal, type ContentHash, type ControlPaths, type ProposedChange, type Result, type StoragePort, type VaultPort } from "../core";
import { ApprovalBindingSchema, parseChangeProposal } from "./contracts";

const status = z.enum(["not-attempted", "pending", "applied", "refused", "unknown", "conflicted", "unchanged"]);
const recordSchema = z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/), at: z.number().int().nonnegative(), binding: ApprovalBindingSchema,
  parent: z.string().regex(/^[a-f0-9]{64}$/).nullable(), outcomes: z.array(status).min(1).max(RECOVERY_LIMITS.files) });
const schema = z.strictObject({ version: z.literal(1), records: z.array(recordSchema).max(RECOVERY_LIMITS.records) });
export type RecoveryRecord = z.infer<typeof recordSchema>;
export interface RecoveryJournal {
  records(): Promise<Result<readonly RecoveryRecord[]>>;
  begin(binding: ApprovalBinding, parent?: string): Promise<Result<string>>;
  outcome(id: string, index: number, value: RecoveryRecord["outcomes"][number]): Promise<Result<void>>;
  reconcile(): Promise<Result<readonly RecoveryRecord[]>>;
  revert(id: string, paths: ControlPaths, instructionsHash: ContentHash, policyHash: ContentHash): Promise<Result<ChangeProposal>>;
}
const refused = (): Result<never> => err(synapseError({ code: "STORAGE_WRITE_FAILED", message: "Recovery unavailable", detail: { issueCode: "RECOVERY_UNAVAILABLE" } }));
const file = "recovery.json";
/** Approval-free bounded history. Persistence failure or external divergence blocks writes.
 * Reconciliation only observes; it never retries a vault operation. */
export function createRecoveryJournal(deps: { storage: StoragePort; vault: VaultPort; now(): number }): RecoveryJournal {
  let chain: Promise<unknown> = Promise.resolve();
  let baseline: string | null = null;
  let records: RecoveryRecord[] = [];
  let loaded = false;
  let blocked = false;
  function serialized<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const next = chain.then(async () => { try { return await work(); } catch { blocked = true; return refused(); } });
    chain = next.then(() => undefined);
    return next;
  }
  async function load(): Promise<boolean> {
    if (blocked) return false;
    const raw = await deps.storage.readJson(file);
    const text = stableStringify(raw);
    if (loaded) { if (text !== baseline) blocked = true; return !blocked; }
    loaded = true; baseline = text;
    if (raw === null) return true;
    if (text.length > RECOVERY_LIMITS.chars) { blocked = true; return false; }
    const parsed = schema.safeParse(raw);
    if (!parsed.success || new Set(parsed.data.records.map((r) => r.id)).size !== parsed.data.records.length) { blocked = true; return false; }
    for (const record of parsed.data.records) {
      const hash = await hashApprovalBinding(record.binding);
      if (!hash.ok || hash.value !== record.id || record.outcomes.length !== record.binding.changes.length) { blocked = true; return false; }
    }
    records = parsed.data.records;
    return true;
  }
  function prune(): void {
    records = records.filter((r) => deps.now() - r.at < RECOVERY_LIMITS.retentionMs || r.outcomes.some((s) => ["pending", "unknown"].includes(s)));
  }
  async function save(): Promise<boolean> {
    // Check for sync/external edits immediately before persistence; never merge authority.
    if (blocked || stableStringify(await deps.storage.readJson(file)) !== baseline) { blocked = true; return false; }
    const value = { version: 1, records };
    if (stableStringify(value).length > RECOVERY_LIMITS.chars) { blocked = true; return false; }
    await deps.storage.writeJson(file, value);
    baseline = stableStringify(value);
    return true;
  }
  async function reconcile(): Promise<Result<readonly RecoveryRecord[]>> {
    if (!await load()) return refused();
    for (const record of records) {
      for (let i = 0; i < record.outcomes.length; i++) {
        if (!["pending", "unknown"].includes(record.outcomes[i])) continue;
        const change = record.binding.changes[i];
        try {
          const files = (await deps.vault.listFiles()).filter((f) => f.path.toLowerCase() === change.path.toLowerCase());
          const exists = files.length === 1 && files[0].path === change.path && files[0].kind === "note";
          const text = exists ? await deps.vault.readText(change.path) : null;
          record.outcomes[i] = exists && text === change.after ? "applied"
            : change.target.exists ? exists && text === change.before ? "unchanged" : "conflicted"
              : files.length === 0 ? "unchanged" : "conflicted";
        } catch { record.outcomes[i] = "unknown"; }
      }
    }
    prune();
    return await save() ? ok(structuredClone(records)) : refused();
  }
  return {
    records: () => serialized(async () => { if (!await load()) return refused(); prune(); return await save() ? ok(structuredClone(records)) : refused(); }),
    reconcile: () => serialized(reconcile),
    begin: (binding, parent) => serialized(async () => {
      if (!await load()) return refused();
      const parsed = ApprovalBindingSchema.safeParse(binding);
      const hash = parsed.success ? await hashApprovalBinding(parsed.data) : null;
      if (!parsed.success || !hash?.ok || records.some((r) => r.id === hash.value || (parent && r.parent === parent))) return refused();
      if (parent && !records.some((r) => r.id === parent)) return refused();
      const now = deps.now();
      // Only resolved, expired histories may be pruned. The independent inbox ledger
      // retains reapply prevention after recovery text expires.
      prune();
      if (records.length >= RECOVERY_LIMITS.records) return refused();
      const record: RecoveryRecord = { id: hash.value, at: now, binding: structuredClone(parsed.data), parent: parent ?? null, outcomes: binding.changes.map(() => "not-attempted") };
      if (stableStringify({ version: 1, records: [...records, record] }).length > RECOVERY_LIMITS.chars) return refused();
      records.push(record);
      return await save() ? ok(hash.value) : refused();
    }),
    outcome: (id, index, value) => serialized(async () => {
      if (!await load()) return refused();
      const record = records.find((r) => r.id === id);
      if (!record || index < 0 || index >= record.outcomes.length) return refused();
      record.outcomes[index] = value;
      return await save() ? ok(undefined) : refused();
    }),
    revert: (id, paths, instructionsHash, policyHash) => serialized(async () => {
      const recovered = await reconcile();
      if (!recovered.ok) return recovered;
      const record = records.find((r) => r.id === id);
      if (!record || record.parent || records.some((r) => r.parent === id) || record.binding.batch.source !== paths.research) return refused();
      const changes: ProposedChange[] = [];
      for (const [i, original] of record.binding.changes.entries()) {
        if (record.outcomes[i] !== "applied") continue;
        if (await deps.vault.readText(original.path) !== original.after) return refused();
        const hash = await contentHash(original.after); if (!hash.ok) return refused();
        changes.push({ ...original, operation: "update", target: { exists: true, hash: hash.value }, before: original.after, after: original.before });
      }
      return parseChangeProposal({ version: 1, id, batch: record.binding.batch, instructionsHash, policyHash, changes, issues: [] }, paths);
    }),
  };
}

export function recoveryReport(record: RecoveryRecord): ApplyReport {
  return { recoveryId: record.id, outcomes: record.binding.changes.map((change, i) => ({ path: change.path,
    status: record.outcomes[i] === "applied" ? "applied" : record.outcomes[i] === "not-attempted" ? "not-attempted" : record.outcomes[i] === "unchanged" || record.outcomes[i] === "refused" ? "refused" : "unknown" })) };
}
