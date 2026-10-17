import { withMetadata } from "../../test/note-metadata-fixture";
import { describe, expect, it, vi } from "vitest";
import { asVaultPath, hashApprovalBinding, type Approval, type ChangeProposal, type ContentHash } from "../core";
import { createReviewApproval, type ReviewDecision } from "./index";
const hash = "a".repeat(64) as ContentHash;
const paths = { instructions: asVaultPath("Synapse/Instructions.md"), research: asVaultPath("Research.md") };
function fixture() {
  const proposal: ChangeProposal = { version: 1, id: "proposal" as ChangeProposal["id"], instructionsHash: hash, policyHash: hash,
    batch: { id: "batch" as ChangeProposal["batch"]["id"], source: paths.research, sourceHash: hash, selectedHash: hash, range: { start: 0, end: 5 }, provenance: "local" },
    changes: ["One.md", "Two.md"].map((path, i) => ({ destinationId: `D${i + 1}` as ChangeProposal["changes"][number]["destinationId"], path: asVaultPath(path), operation: "create", target: { exists: false }, before: "", after: withMetadata(`# ${path}\n`), evidenceIds: ["E1"] })), issues: [] };
  let generation = "initial";
  const validate = vi.fn(async () => true);
  const service = createReviewApproval({ proposal, paths, validate, version: () => generation });
  return { proposal, validate, service, invalidate: () => { generation = "changed"; } };
}
describe("local review authority", () => {
  it("binds precisely the accepted subset, in proposal order, and consumes once", async () => {
    const f = fixture(); const result = await f.service.approve(["reject", "accept"]);
    expect(result.ok).toBe(true); if (!result.ok) return;
    const consumed = await f.service.consume(result.value);
    expect(consumed.ok).toBe(true); if (!consumed.ok) return;
    expect(consumed.value.changes).toEqual([f.proposal.changes[1]]);
    expect(await hashApprovalBinding(consumed.value)).toEqual({ ok: true, value: result.value.bindingHash });
    expect(Object.isFrozen(consumed.value.changes)).toBe(true);
    expect((await f.service.consume(result.value)).ok).toBe(false);
  });
  it.each([["undecided", "accept"], ["reject", "reject"], ["accept"], ["accept", "forged"]])("refuses unresolved or empty decisions %j", async (...decisions) => {
    const f = fixture(); expect((await f.service.approve(decisions as ReviewDecision[])).ok).toBe(false);
    expect(f.validate).not.toHaveBeenCalled();
  });
  it("refuses proposal issues and restricted targets", async () => {
    const f = fixture();
    for (const proposal of [{ ...f.proposal, issues: [{ code: "ambiguous" }] }, { ...f.proposal, changes: [{ ...f.proposal.changes[0], path: paths.instructions }] }]) {
      const service = createReviewApproval({ proposal, paths, validate: f.validate, version: () => "initial" });
      expect((await service.approve(proposal.changes.map(() => "accept"))).ok).toBe(false);
    }
  });
  it("does not accept serialized or fabricated authority and keeps the original usable", async () => {
    const f = fixture(); const result = await f.service.approve(["accept", "accept"]);
    if (!result.ok) throw Error("approval");
    expect((await f.service.consume(JSON.parse(JSON.stringify(result.value)) as Approval)).ok).toBe(false);
    expect((await f.service.consume(result.value)).ok).toBe(true);
  });
  it("snapshots decision data before awaiting and owns immutable proposal data", async () => {
    const f = fixture(); const decisions: ReviewDecision[] = ["accept", "reject"];
    const pending = f.service.approve(decisions);
    decisions.reverse();
    (f.proposal.changes[0] as { after: string }).after = "tampered";
    const result = await pending; if (!result.ok) throw Error("approval");
    const consumed = await f.service.consume(result.value); if (!consumed.ok) throw Error("consume");
    expect(consumed.value.changes[0].path).toBe("One.md");
    expect(consumed.value.changes[0].after).toBe(withMetadata("# One.md\n"));
  });
  it("fails closed on validation errors, changes during validation and post-issue revocation", async () => {
    const f = fixture(); f.validate.mockImplementationOnce(async () => { f.invalidate(); return true; });
    expect((await f.service.approve(["accept", "accept"])).ok).toBe(false);
    const g = fixture(); g.validate.mockRejectedValueOnce(Error("private source text"));
    expect((await g.service.approve(["accept", "accept"])).ok).toBe(false);
    const h = fixture(); const result = await h.service.approve(["accept", "accept"]); if (!result.ok) throw Error("approval");
    h.service.invalidate(); expect((await h.service.consume(result.value)).ok).toBe(false);
  });
  it("revalidates consumption and prevents concurrent issue and replay", async () => {
    const f = fixture(); const first = f.service.approve(["accept", "reject"]);
    expect((await f.service.approve(["accept", "accept"])).ok).toBe(false);
    const result = await first; if (!result.ok) throw Error("approval");
    f.validate.mockResolvedValueOnce(false);
    const consumed = f.service.consume(result.value);
    expect((await f.service.consume(result.value)).ok).toBe(false);
    expect((await consumed).ok).toBe(false);
  });
});
