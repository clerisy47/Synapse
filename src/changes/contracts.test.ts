import { describe, expect, it } from "vitest";
import { asVaultPath } from "../core";
import { parseApprovalBinding, parseChangeProposal } from "./index";

const hash = "a".repeat(64);
const paths = { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") };
const change = { destinationId: "daily-log", path: "Daily/2026-10-14.md", operation: "create", target: { exists: false }, before: "", after: "## Log\nResearch\n", evidenceIds: ["E1"] };
const proposal = { version: 1, id: "proposal-one", batch: { id: "batch-one", source: "Research.md", sourceHash: hash, selectedHash: hash, range: { start: 0, end: 12 }, provenance: "external" }, instructionsHash: hash, policyHash: hash, changes: [change], issues: [] };

describe("local proposal representation", () => {
  it("accepts bounded create/update data without granting approval", () => {
    expect(parseChangeProposal(proposal, paths).ok).toBe(true);
    expect(parseChangeProposal({ ...proposal, changes: [{ ...change, operation: "update", target: { exists: true, hash }, before: "Previous content" }] }, paths).ok).toBe(true);
    expect(parseChangeProposal({ ...proposal, approved: true }, paths).ok).toBe(false);
  });
  it.each([
    { ...proposal, version: 2 }, { ...proposal, policyHash: "not-a-hash" }, { ...proposal, changes: [] },
    { ...proposal, changes: [{ ...change, path: "../Outside.md" }] },
    { ...proposal, changes: [{ ...change, path: "Synapse/Security.md" }] },
    { ...proposal, changes: [{ ...change, path: "synapse/instructions.md" }] },
    { ...proposal, changes: [{ ...change, path: "Research.md" }] },
    { ...proposal, batch: { ...proposal.batch, source: "Notes/Other.md" } },
    { ...proposal, batch: { ...proposal.batch, range: { start: 5, end: 5 } } },
    { ...proposal, changes: [{ ...change, target: { exists: true, hash } }] },
    { ...proposal, changes: [{ ...change, before: "Overwrite existing note" }] },
    { ...proposal, changes: [{ ...change, operation: "update" }] },
    { ...proposal, changes: [{ ...change, operation: "delete" }] },
    { ...proposal, changes: [{ ...change, evidenceIds: ["E0"] }] },
    { ...proposal, changes: [{ ...change, evidenceIds: ["E1.2"] }] },
    { ...proposal, changes: [{ ...change, evidenceIds: ["secret-quote"] }] },
    { ...proposal, changes: [{ ...change, quotes: ["model supplied quote"] }] },
    { ...proposal, changes: [change, { ...change, path: "daily/2026-10-14.md" }] },
    { ...proposal, issues: [{ code: "ambiguous-date", changeIndex: 1 }] },
  ])("rejects invalid or restricted proposal data %#", (input) => expect(parseChangeProposal(input, paths).ok).toBe(false));
  it("accepts unresolved issues as data, which must block future approval", () => {
    const result = parseChangeProposal({ ...proposal, issues: [{ code: "ambiguous-date", changeIndex: 0 }] }, paths);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.issues).toEqual([{ code: "ambiguous-date", changeIndex: 0 }]);
  });
  it("never accepts a serialized approval token or source of authority", () => {
    const { id, issues: _issues, ...rest } = proposal;
    const binding = { ...rest, proposalId: id };
    expect(parseApprovalBinding(binding).ok).toBe(true);
    expect(parseApprovalBinding({ ...binding, approved: true, issuedBy: "external-client" }).ok).toBe(false);
    expect(parseApprovalBinding({ ...binding, token: "user-approval" }).ok).toBe(false);
  });
});
