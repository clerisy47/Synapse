import { describe, expect, it, vi } from "vitest";
import { RESEARCH_LEDGER_MAX_RECORDS } from "../constants";
import { asVaultPath, type BatchId, type ContentHash, type ResearchLedger, type ResearchLedgerRecord, type ResearchProcessingState } from "../core";
import { FakeClock, MemoryStorage } from "../../test/fakes";
import { cloneResearchLedger, createStateStore, defaultPersistedState, emptyResearchLedger, loadStateStore, mergeResearchLedgers, mergeState, parsePersisted, parseResearchLedger } from "./index";

function record(index = 1, history: readonly ResearchProcessingState[] = ["captured"], stamp = 10): ResearchLedgerRecord {
  return {
    batch: { id: index.toString(16).padStart(64, "0") as BatchId, source: asVaultPath("Research.md"), sourceHash: "a".repeat(64) as ContentHash, selectedHash: "b".repeat(64) as ContentHash, range: { start: 0, end: 10 }, provenance: "local" },
    firstCapturedAt: 10, lastCapturedAt: stamp, outcomes: history, conflicted: false,
  };
}
function ledger(...records: ResearchLedgerRecord[]): ResearchLedger { return { version: 1, blocked: false, records }; }
const options = () => ({ clock: new FakeClock(), schedule: () => () => {} });

describe("research ledger persistence", () => {
  it("migrates existing data with an empty ledger and validates exact known shapes", () => {
    expect(parsePersisted({}).state.researchLedger).toEqual(emptyResearchLedger());
    expect(parseResearchLedger(ledger(record()))).toEqual(ledger(record()));
    for (const raw of [null, { version: 2, blocked: false, records: [] }, { ...ledger(record()), approval: "forged" }, ledger({ ...record(), batch: { ...record().batch, source: asVaultPath("../Secret.md") } }), ledger({ ...record(), batch: { ...record().batch, range: { start: 10, end: 5 } } }), ledger(record(), record()), ledger({ ...record(), outcomes: [] }), ledger({ ...record(), lastCapturedAt: 0 })]) {
      expect(parseResearchLedger(raw)).toEqual({ version: 1, blocked: true, records: [] });
      expect(parsePersisted({ researchLedger: raw }).warnings).toEqual(["researchLedger unavailable; research processing blocked"]);
    }
  });

  it("blocks content/authority fields rather than preserving them as unknown research state", () => {
    const raw = { ...ledger(record()), records: [{ ...record(), text: "private note body", approval: true }] };
    const parsed = parsePersisted({ researchLedger: raw });
    expect(parsed.state.researchLedger.blocked).toBe(true); expect(JSON.stringify(parsed.state)).not.toMatch(/private note body|approval/);
  });

  it("unions batch records independently of settings stamps and preserves application history", () => {
    const before = record(1, ["captured", "partially-applied"], 20);
    const stale = record(1, ["captured"], 30);
    const a = { ...defaultPersistedState(), settingsUpdatedAt: 1, researchLedger: ledger(before) };
    const b = { ...defaultPersistedState(), settingsUpdatedAt: 100, researchLedger: ledger(stale, record(2)) };
    const merged = mergeState(a, b);
    expect(merged.researchLedger.records).toHaveLength(2);
    expect(merged.researchLedger.records[0].outcomes).toEqual(["captured", "partially-applied"]);
    expect(mergeState(b, a).researchLedger).toEqual(merged.researchLedger);
  });

  it("detects outcome and identity conflicts without erasing applied history", () => {
    const applied = ledger(record(1, ["captured", "applied"]));
    const rejected = ledger(record(1, ["captured", "rejected"]));
    const conflict = mergeResearchLedgers(applied, rejected);
    expect(conflict.records[0]).toMatchObject({ conflicted: true, outcomes: ["captured", "rejected", "applied"] });
    expect(parseResearchLedger(conflict).records[0].conflicted).toBe(true);
    const tampered = { ...record(), batch: { ...record().batch, selectedHash: "c".repeat(64) as ContentHash } };
    expect(mergeResearchLedgers(applied, ledger(tampered)).records[0].conflicted).toBe(true);
  });

  it("merges histories commutatively, associatively and idempotently", () => {
    const fixtures = [emptyResearchLedger(), ledger(record()), ledger(record(1, ["captured", "proposed"], 20)), ledger(record(1, ["captured", "rejected"], 30)), ledger(record(1, ["captured", "partially-applied"], 40), record(2)), ledger(record(1, ["captured", "applied"], 50)), { ...ledger(record()), blocked: true }];
    for (const a of fixtures) for (const b of fixtures) for (const c of fixtures) {
      expect(mergeResearchLedgers(a, b)).toEqual(mergeResearchLedgers(b, a));
      expect(mergeResearchLedgers(mergeResearchLedgers(a, b), c)).toEqual(mergeResearchLedgers(a, mergeResearchLedgers(b, c)));
      expect(mergeResearchLedgers(a, a)).toEqual(a);
    }
  });

  it("clones snapshots, ranges and outcome arrays without aliases", async () => {
    const source = ledger(record()); const cloned = cloneResearchLedger(source);
    expect(cloned.records[0]).not.toBe(source.records[0]); expect(cloned.records[0].batch.range).not.toBe(source.records[0].batch.range);
    expect(cloned.records[0].outcomes).not.toBe(source.records[0].outcomes);
    const storage = new MemoryStorage(); const initial = { ...defaultPersistedState(), researchLedger: source };
    const store = createStateStore({ ...options(), storage, initial });
    await store.flush(); const loaded = await loadStateStore({ ...options(), storage });
    expect(loaded.store.get().researchLedger).toEqual(source);
    expect(loaded.store.get().researchLedger).not.toBe(source);
    store.dispose(); loaded.store.dispose();
  });

  it("keeps blocked histories blocked during sync, including overflow", () => {
    const full = ledger(...Array.from({ length: RESEARCH_LEDGER_MAX_RECORDS }, (_, index) => record(index)));
    expect(parseResearchLedger(full).blocked).toBe(false);
    const overflow = mergeResearchLedgers(full, ledger(record(RESEARCH_LEDGER_MAX_RECORDS)));
    expect(overflow.blocked).toBe(true); expect(overflow.records).toHaveLength(RESEARCH_LEDGER_MAX_RECORDS);
    expect(parseResearchLedger(overflow)).toEqual(overflow);
    const extra = ledger(record(RESEARCH_LEDGER_MAX_RECORDS + 1));
    expect(mergeResearchLedgers(overflow, extra)).toEqual(mergeResearchLedgers(full, mergeResearchLedgers(ledger(record(RESEARCH_LEDGER_MAX_RECORDS)), extra)));
    expect(mergeResearchLedgers({ version: 1, blocked: true, records: [] }, ledger(record(1, ["captured", "applied"])))).toMatchObject({ blocked: true, records: [{ outcomes: ["captured", "applied"] }] });
  });

  it("reload-merges external ledger changes and clears plugin history while preserving settings", async () => {
    const storage = new MemoryStorage();
    const initial = { ...defaultPersistedState(), researchLedger: ledger(record(1, ["captured", "applied"])) };
    const store = createStateStore({ ...options(), storage, initial });
    await storage.saveData({ ...defaultPersistedState(), researchLedger: ledger(record(2)) });
    await store.reloadAndMerge(); expect(store.get().researchLedger.records).toHaveLength(2);
    const settings = store.get().settings;
    await store.clearAll(); expect(store.get().researchLedger).toEqual(emptyResearchLedger()); expect(store.get().settings).toEqual(settings);
    store.dispose();
  });

  it("recovers the save chain after a storage failure without hiding the failed flush", async () => {
    const storage = new MemoryStorage(); const save = vi.spyOn(storage, "saveData").mockRejectedValueOnce(new Error("disk unavailable"));
    const store = createStateStore({ ...options(), storage });
    store.update((s) => { s.researchLedger = ledger(record()); });
    await expect(store.flush()).rejects.toThrow("disk unavailable");
    await store.flush(); expect(save).toHaveBeenCalledTimes(2);
    expect(parsePersisted(await storage.loadData()).state.researchLedger).toEqual(ledger(record()));
    store.dispose();
  });
});
