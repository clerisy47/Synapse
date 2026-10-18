import { describe, expect, it } from "vitest";
import { asVaultPath, contentHash, hashApprovalBinding, validateControlPaths, validateVaultPath, type ApprovalBinding, type BatchId, type ContentHash, type DestinationId, type ProposalId } from "./index";

const hash = "a".repeat(64) as ContentHash;
function binding(): ApprovalBinding {
  return {
    version: 1, proposalId: "proposal-one" as ProposalId,
    batch: { id: "batch-one" as BatchId, source: asVaultPath("Research.md"), sourceHash: hash, selectedHash: hash, range: { start: 0, end: 20 }, provenance: "local" },
    instructionsHash: hash, policyHash: hash,
    changes: [{ destinationId: "daily-log" as DestinationId, path: asVaultPath("Daily/2026-10-14.md"), operation: "update", target: { exists: true, hash }, before: "before", after: "after", evidenceIds: ["E1"] }],
  };
}

describe("canonical control paths", () => {
  it("normalizes separators without changing the legacy branding helper", () => {
    expect(validateVaultPath("Notes\\Item.md")).toEqual({ ok: true, value: "Notes/Item.md" });
    expect(asVaultPath("../anything.md")).toBe("../anything.md");
    expect(validateVaultPath("Daily", "folder")).toEqual({ ok: true, value: "Daily" });
  });
  it.each(["", "/a.md", "C:\\a.md", "../a.md", "A/../a.md", "./a.md", "A//a.md", "a.md/", "a.pdf", "https://a.md", "A/%2e%2e/a.md", "a.md\u0000", " a.md", "A/ a.md", ".config/a.md", "A/.hidden/a.md", "a?.md", "a*.md", "a|.md", "A\\..\\a.md"])("rejects %j", (path) => {
    const result = validateVaultPath(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.error)).not.toContain(path || "sentinel-secret");
  });
  it("rejects collisions after separator and case normalization", () => {
    expect(validateControlPaths({ instructions: "Synapse\\Rules.md", research: "synapse/rules.md" }).ok).toBe(false);
    expect(validateControlPaths({ instructions: "Synapse/Instructions.md", research: "Research.md" }).ok).toBe(true);
  });
});

describe("snapshot and approval hashing", () => {
  it("uses full SHA-256 of exact content", async () => {
    expect(await contentHash("abc")).toEqual({ ok: true, value: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
    expect(await contentHash("abc\n")).not.toEqual(await contentHash("abc"));
  });
  it("is deterministic across object-key insertion order", async () => {
    const value = binding();
    expect(await hashApprovalBinding(value)).toEqual(await hashApprovalBinding({ changes: value.changes, policyHash: hash, instructionsHash: hash, batch: value.batch, proposalId: value.proposalId, version: 1 }));
  });
  it("binds every source, target and rule snapshot plus the exact selected diff", async () => {
    const value = binding();
    const original = await hashApprovalBinding(value);
    const changedHash = "b".repeat(64) as ContentHash;
    const variants: ApprovalBinding[] = [
      { ...value, proposalId: "proposal-two" as ProposalId },
      { ...value, policyHash: changedHash }, { ...value, instructionsHash: changedHash },
      { ...value, batch: { ...value.batch, sourceHash: changedHash } },
      { ...value, batch: { ...value.batch, selectedHash: changedHash } },
      { ...value, batch: { ...value.batch, range: { start: 1, end: 20 } } },
      { ...value, batch: { ...value.batch, provenance: "external" } },
      { ...value, changes: [{ ...value.changes[0], after: "edited" }] },
      { ...value, changes: [{ ...value.changes[0], before: "edited" }] },
      { ...value, changes: [{ ...value.changes[0], path: asVaultPath("Other.md") }] },
      { ...value, changes: [{ ...value.changes[0], destinationId: "other" as DestinationId }] },
      { ...value, changes: [{ ...value.changes[0], target: { exists: true, hash: changedHash } }] },
      { ...value, changes: [{ ...value.changes[0], target: { exists: false }, operation: "create", before: "" }] },
      { ...value, changes: [{ ...value.changes[0], evidenceIds: ["E2"] }] },
      { ...value, changes: [] },
    ];
    for (const variant of variants) expect(await hashApprovalBinding(variant)).not.toEqual(original);
    const two = { ...value, changes: [...value.changes, { ...value.changes[0], path: asVaultPath("Other.md") }] };
    expect(await hashApprovalBinding(two)).not.toEqual(await hashApprovalBinding({ ...two, changes: [...two.changes].reverse() }));
  });
});
