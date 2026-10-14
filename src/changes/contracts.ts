import { z } from "zod";
import { CONTROL_LIMITS } from "../constants";
import { err, ok, synapseError, validateVaultPath, type ApprovalBinding, type BatchId, type ChangeProposal, type ContentHash, type ControlPaths, type DestinationId, type ExcerptId, type ProposalId, type Result } from "../core";

const hash = z.string().regex(/^[a-f0-9]{64}$/).transform((value) => value as ContentHash);
const id = z.string().min(1).max(CONTROL_LIMITS.identifierChars).regex(/^[a-zA-Z0-9-]+$/);
const path = z.string().max(CONTROL_LIMITS.pathChars).transform((value, ctx) => {
  const result = validateVaultPath(value);
  if (!result.ok) { ctx.addIssue({ code: "custom", message: "INVALID_VAULT_PATH" }); return z.NEVER; }
  return result.value;
});
const batch = z.strictObject({
  id: id.transform((value) => value as BatchId), source: path,
  sourceHash: hash, selectedHash: hash,
  range: z.strictObject({ start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), end: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).refine((value) => value.end > value.start, "INVALID_SOURCE_RANGE"),
  provenance: z.enum(["local", "external"]),
});
const change = z.strictObject({
  destinationId: id.transform((value) => value as DestinationId), path,
  operation: z.enum(["create", "update"]),
  target: z.discriminatedUnion("exists", [z.strictObject({ exists: z.literal(false) }), z.strictObject({ exists: z.literal(true), hash })]),
  before: z.string().max(CONTROL_LIMITS.markdownChars), after: z.string().max(CONTROL_LIMITS.markdownChars),
  evidenceIds: z.array(z.string().max(CONTROL_LIMITS.identifierChars).regex(/^E[1-9]\d*$/).transform((value) => value as ExcerptId)).max(CONTROL_LIMITS.evidenceIds),
}).superRefine((value, ctx) => {
  if (value.operation === "create" ? value.target.exists || value.before !== "" : !value.target.exists) ctx.addIssue({ code: "custom", message: "TARGET_OPERATION_CONFLICT" });
});
const fields = {
  version: z.literal(1),
  proposalId: id.transform((value) => value as ProposalId), batch,
  instructionsHash: hash, policyHash: hash,
  changes: z.array(change).min(1).max(CONTROL_LIMITS.changes),
};
function noRepeatedTargets(value: { changes: readonly { path: string }[] }, ctx: z.RefinementCtx): void {
  const paths = value.changes.map((item) => item.path.toLowerCase());
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_TARGET" });
}
/** Trusted local proposal representation, never a model response or authority token. */
export const ApprovalBindingSchema = z.strictObject(fields).superRefine(noRepeatedTargets);
export const ChangeProposalSchema = z.strictObject({
  version: fields.version, id: fields.proposalId, batch, instructionsHash: hash, policyHash: hash, changes: fields.changes,
  issues: z.array(z.strictObject({ code: id, changeIndex: z.number().int().nonnegative().max(CONTROL_LIMITS.changes - 1).optional() })).max(CONTROL_LIMITS.changes),
}).superRefine((value, ctx) => {
  noRepeatedTargets(value, ctx);
  if (value.issues.some((issue) => issue.changeIndex !== undefined && issue.changeIndex >= value.changes.length)) ctx.addIssue({ code: "custom", message: "INVALID_CHANGE_INDEX" });
});

export function parseChangeProposal(input: unknown, paths: ControlPaths): Result<ChangeProposal> {
  const result = ChangeProposalSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid proposal contract", detail: { issueCode: issue?.code === "custom" ? issue.message : "PROPOSAL_SCHEMA_INVALID", field: issue?.path.join(".") ?? "" } }));
  }
  if (result.data.batch.source !== paths.research || result.data.changes.some((item) => [paths.instructions, paths.security, paths.research].some((control) => control.toLowerCase() === item.path.toLowerCase()))) return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Proposal source or target is restricted", detail: { issueCode: "RESTRICTED_PROPOSAL_PATH" } }));
  return ok({ ...result.data, issues: result.data.issues.map((issue) => ({ code: issue.code, ...(issue.changeIndex === undefined ? {} : { changeIndex: issue.changeIndex }) })) });
}

/** Returns binding data only. The local UI must issue and consume authority separately. */
export function parseApprovalBinding(input: unknown): Result<ApprovalBinding> {
  const result = ApprovalBindingSchema.safeParse(input);
  if (result.success) return ok(result.data);
  return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid approval binding", detail: { issueCode: "APPROVAL_BINDING_INVALID" } }));
}
