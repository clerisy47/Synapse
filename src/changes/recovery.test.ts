import { withMetadata } from "../../test/note-metadata-fixture";
import { describe, expect, it, vi } from "vitest";
import { RECOVERY_LIMITS } from "../constants";
import { asVaultPath, contentHash, ok, type ApprovalBinding, type ChangeProposal, type ContentHash } from "../core";
import { createRecoveryJournal, createReviewApproval, applyReviewedChanges } from "./index";
import { FakeVault, MemoryStorage } from "../../test/fakes";

const paths = { instructions: asVaultPath("Instructions.md"), research: asVaultPath("Research.md") };
const hash = "a".repeat(64) as ContentHash;
async function fixture() {
  const storage = new MemoryStorage(); const vault = new FakeVault();
  const before = await contentHash("before"); if (!before.ok) throw Error("hash");
  const binding: ApprovalBinding = { version: 1, proposalId: "proposal" as ApprovalBinding["proposalId"], instructionsHash: hash, policyHash: hash,
    batch: { id: "batch" as ApprovalBinding["batch"]["id"], source: paths.research, sourceHash: hash, selectedHash: hash, range: { start: 0, end: 5 }, provenance: "local" },
    changes: [ { destinationId: "D1" as ApprovalBinding["changes"][number]["destinationId"], path: asVaultPath("One.md"), operation: "update", target: { exists: true, hash: before.value }, before: "before", after: withMetadata("after"), evidenceIds: ["E1"] },
      { destinationId: "D2" as ApprovalBinding["changes"][number]["destinationId"], path: asVaultPath("Two.md"), operation: "create", target: { exists: false }, before: "", after: withMetadata("new"), evidenceIds: ["E1"] } ] };
  vault.addNote({ path: "One.md", text: "before" });
  let now = 1;
  const restart = () => createRecoveryJournal({ storage, vault, now: () => now });
  const journal = restart();
  return { storage, vault, binding, journal, restart, advance: () => { now += RECOVERY_LIMITS.retentionMs + 1; } };
}
function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T { if (!result.ok) throw Error("unexpected refusal"); return result.value; }

describe("durable recovery", () => {
  it.each(["before-write", "after-write", "divergent"])("reconciles %s without writing or authorizing replay", async (fault) => {
    const f = await fixture(); const id = unwrap(await f.journal.begin(f.binding));
    unwrap(await f.journal.outcome(id, 0, "pending"));
    if (fault !== "before-write") f.vault.addNote({ path: "One.md", text: fault === "after-write" ? withMetadata("after") : "edited" });
    const restarted = f.restart();
    const records = unwrap(await restarted.reconcile());
    expect(records[0].outcomes).toEqual([fault === "before-write" ? "unchanged" : fault === "after-write" ? "applied" : "conflicted", "not-attempted"]);
    expect((await restarted.begin(f.binding)).ok).toBe(false);
    expect(await f.vault.readText(asVaultPath("One.md"))).toBe(fault === "before-write" ? "before" : fault === "after-write" ? withMetadata("after") : "edited");
  });
  it("distinguishes created empty files from absent files", async () => {
    const f = await fixture(); const binding = { ...f.binding, changes: [{ ...f.binding.changes[1], after: "" }] };
    const id = unwrap(await f.journal.begin(binding)); unwrap(await f.journal.outcome(id, 0, "pending"));
    expect(unwrap(await f.restart().reconcile())[0].outcomes).toEqual(["unchanged"]);
    // A separate restart observes an unknown outcome with an existing empty file.
    const stored = await f.storage.readJson("recovery.json") as { records: { outcomes: string[] }[] };
    stored.records[0].outcomes[0] = "pending"; await f.storage.writeJson("recovery.json", stored);
    f.vault.addNote({ path: "Two.md", text: "" });
    expect(unwrap(await f.restart().reconcile())[0].outcomes).toEqual(["applied"]);
  });
  it("fails closed on malformed, tampered or externally changed journals", async () => {
    const f = await fixture(); unwrap(await f.journal.begin(f.binding));
    const original = await f.storage.readJson("recovery.json") as { records: { binding: { changes: { after: string }[] } }[] };
    original.records[0].binding.changes[0].after = "tampered";
    await f.storage.writeJson("recovery.json", original);
    expect((await f.journal.records()).ok).toBe(false);
    expect((await f.restart().records()).ok).toBe(false);
    await f.storage.writeJson("recovery.json", { version: 99 });
    expect((await f.restart().records()).ok).toBe(false);
  });
  it("never calls the writer when intent persistence fails", async () => {
    const f = await fixture();
    const { proposalId, ...fields } = f.binding;
    const proposal: ChangeProposal = { ...fields, id: proposalId, issues: [] };
    const authority = createReviewApproval({ proposal, paths, validate: async () => true, version: () => "current" });
    const approval = unwrap(await authority.approve(["accept", "accept"]));
    const write = f.storage.writeJson.bind(f.storage); let writes = 0;
    vi.spyOn(f.storage, "writeJson").mockImplementation(async (path, data) => { if (++writes === 2) throw Error("intent fault"); await write(path, data); });
    const apply = vi.fn(async () => ok(undefined));
    const result = unwrap(await applyReviewedChanges({ authority, approval, journal: f.journal, writer: { apply }, paths, signal: new AbortController().signal,
      begin: async () => ok(undefined), current: () => true, validate: async () => true, editorSnapshots: () => [], willCommit() {}, completed() {} }));
    expect(apply).not.toHaveBeenCalled();
    expect(result.outcomes.map((r) => r.status)).toEqual(["not-attempted", "not-attempted"]);
  });
  it("preserves exact success and stops after completion persistence fails", async () => {
    const f = await fixture();
    const { proposalId, ...fields } = f.binding;
    const proposal: ChangeProposal = { ...fields, id: proposalId, issues: [] };
    const authority = createReviewApproval({ proposal, paths, validate: async () => true, version: () => "current" });
    const approval = unwrap(await authority.approve(["accept", "accept"]));
    const write = f.storage.writeJson.bind(f.storage); let writes = 0;
    vi.spyOn(f.storage, "writeJson").mockImplementation(async (path, data) => { if (++writes === 3) throw Error("completion fault"); await write(path, data); });
    const apply = vi.fn(async () => { f.vault.addNote({ path: "One.md", text: withMetadata("after") }); return ok(undefined); });
    const result = unwrap(await applyReviewedChanges({ authority, approval, journal: f.journal, writer: { apply }, paths, signal: new AbortController().signal,
      begin: async () => ok(undefined), current: () => true, validate: async () => true, editorSnapshots: () => [], willCommit() {}, completed() {} }));
    expect(apply).toHaveBeenCalledOnce(); expect(result.outcomes.map((r) => r.status)).toEqual(["applied", "not-attempted"]);
    expect(unwrap(await f.restart().reconcile())[0].outcomes).toEqual(["applied", "not-attempted"]);
  });
  it("requires a new diff and refuses stale or repeated reverts", async () => {
    const f = await fixture(); const id = unwrap(await f.journal.begin(f.binding));
    f.vault.addNote({ path: "One.md", text: withMetadata("after") }); f.vault.addNote({ path: "Two.md", text: withMetadata("new") });
    unwrap(await f.journal.outcome(id, 0, "applied")); unwrap(await f.journal.outcome(id, 1, "applied"));
    const proposal = unwrap(await f.journal.revert(id, paths, hash, hash));
    expect(proposal.changes.map((c) => [c.operation, c.before, c.after])).toEqual([["update", withMetadata("after"), "before"], ["update", withMetadata("new"), ""]]);
    f.vault.addNote({ path: "One.md", text: "user edit" });
    expect((await f.journal.revert(id, paths, hash, hash)).ok).toBe(false);
    f.vault.addNote({ path: "One.md", text: withMetadata("after") });
    const revertBinding: ApprovalBinding = { ...proposal, proposalId: proposal.id };
    // Remove proposal-only fields; persisted bindings are strict.
    const { id: _id, issues: _issues, ...rest } = revertBinding as ApprovalBinding & { id: string; issues: unknown[] };
    unwrap(await f.journal.begin(rest, id));
    expect((await f.journal.revert(id, paths, hash, hash)).ok).toBe(false);
  });
  it("bounds retention without evicting unresolved intents", async () => {
    const f = await fixture(); const id = unwrap(await f.journal.begin(f.binding));
    unwrap(await f.journal.outcome(id, 0, "pending")); f.advance();
    unwrap(await f.journal.begin({ ...f.binding, proposalId: "new-proposal" as ApprovalBinding["proposalId"] }));
    expect(unwrap(await f.journal.records())).toHaveLength(2);
    for (let i = 2; i < RECOVERY_LIMITS.records; i++) unwrap(await f.journal.begin({ ...f.binding, proposalId: `p${i}` as ApprovalBinding["proposalId"] }));
    expect((await f.journal.begin({ ...f.binding, proposalId: "overflow" as ApprovalBinding["proposalId"] })).ok).toBe(false);
  });
});
