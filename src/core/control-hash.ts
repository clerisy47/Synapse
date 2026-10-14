import type { ApprovalBinding, ContentHash } from "./control-contracts";
import { stableStringify } from "./text";
import { err, ok, type Result } from "./result";
import { synapseError } from "./errors";

/** Security bindings use full SHA-256; shortened SHA-1 remains for diagnostic paths only. */
export async function contentHash(text: string): Promise<Result<ContentHash>> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return ok([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("") as ContentHash);
  } catch {
    return err(synapseError({ code: "INTERNAL", message: "Content hashing unavailable" }));
  }
}

export function hashApprovalBinding(binding: ApprovalBinding): Promise<Result<ContentHash>> {
  // Explicit projection excludes unrecognized properties and any supplied approval token.
  const batch = binding.batch;
  return contentHash(stableStringify({
    version: binding.version,
    proposalId: binding.proposalId,
    batch: { id: batch.id, source: batch.source, sourceHash: batch.sourceHash, selectedHash: batch.selectedHash, range: { start: batch.range.start, end: batch.range.end }, provenance: batch.provenance },
    instructionsHash: binding.instructionsHash,
    policyHash: binding.policyHash,
    changes: binding.changes.map((change) => ({
      destinationId: change.destinationId, path: change.path, operation: change.operation,
      target: change.target.exists ? { exists: true, hash: change.target.hash } : { exists: false },
      before: change.before, after: change.after, evidenceIds: [...change.evidenceIds],
    })),
  }));
}
