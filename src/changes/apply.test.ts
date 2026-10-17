import { withMetadata } from "../../test/note-metadata-fixture";
import { FakeVault, MemoryStorage } from "../../test/fakes";
import { expect, it, vi } from "vitest";
import { asVaultPath, err, ok, synapseError, type Approval, type ChangeProposal, type ContentHash, type NoteWritePort } from "../core";
import { applyReviewedChanges, createReviewApproval, createRecoveryJournal } from "./index";

it("burns authority once, reports partial/unknown outcomes, and never attempts later changes", async () => {
  const paths = { instructions: asVaultPath("Instructions.md"), research: asVaultPath("Research.md") };
  const hash = "a".repeat(64) as ContentHash;
  const proposal: ChangeProposal = { version: 1, id: "proposal" as ChangeProposal["id"], instructionsHash: hash, policyHash: hash,
    batch: { id: "batch" as ChangeProposal["batch"]["id"], source: paths.research, sourceHash: hash, selectedHash: hash, range: { start: 0, end: 5 }, provenance: "local" },
    changes: ["One.md", "Two.md", "Three.md"].map((path, i) => ({ destinationId: `D${i + 1}` as ChangeProposal["changes"][number]["destinationId"], path: asVaultPath(path), operation: "create", target: { exists: false }, before: "", after: withMetadata("# Synthetic\n"), evidenceIds: ["E1"] })), issues: [] };
  const authority = createReviewApproval({ paths, proposal, validate: async () => true, version: () => "current" });
  const approved = await authority.approve(["accept", "accept", "accept"]); if (!approved.ok) throw Error("approval");
  const apply = vi.fn<NoteWritePort["apply"]>().mockResolvedValueOnce(ok(undefined)).mockResolvedValueOnce(err(synapseError({ code: "STORAGE_WRITE_FAILED", message: "Unknown", detail: { issueCode: "WRITE_OUTCOME_UNKNOWN" } })));
  const begin = vi.fn(async () => ok(undefined)); const completed = vi.fn();
  const journal = createRecoveryJournal({ storage: new MemoryStorage(), vault: new FakeVault(), now: () => 1 });
  const run = (approval: Approval) => applyReviewedChanges({ journal, authority, approval, paths, writer: { apply }, signal: new AbortController().signal,
    current: () => true, validate: async () => true, editorSnapshots: () => [], begin, willCommit: () => {}, completed });
  const result = await run(approved.value);
  if (!result.ok) throw Error("application refused");
  expect(result.value.recoveryId).toMatch(/^[a-f0-9]{64}$/);
  expect(result.value.outcomes).toEqual([{ path: "One.md", status: "applied" }, { path: "Two.md", status: "unknown" }, { path: "Three.md", status: "not-attempted" }]);
  expect(begin).toHaveBeenCalledOnce(); expect(completed).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledTimes(2);
  expect((await run(approved.value)).ok).toBe(false); expect(apply).toHaveBeenCalledTimes(2);
});
