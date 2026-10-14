import { z } from "zod";
import { CONTROL_LIMITS } from "../constants";
import { err, ok, synapseError, validateVaultPath, type Result, type SecurityRules } from "../core";

const identifier = z.string().min(1).max(CONTROL_LIMITS.identifierChars).regex(/^[a-z][a-z0-9-]*$/);
const folder = z.string().max(CONTROL_LIMITS.pathChars).transform((value, ctx) => {
  const result = validateVaultPath(value, "folder");
  if (!result.ok) { ctx.addIssue({ code: "custom", message: "INVALID_VAULT_PATH" }); return z.NEVER; }
  return result.value;
});
const tag = z.string().min(1).max(CONTROL_LIMITS.literalChars).regex(/^#?[^\s#]+(?:\/[^\s#]+)*$/).transform((value) => value.replace(/^#/, "")).refine((value) => value.split("/").every(Boolean));
const selector = z.strictObject({
  folder: folder.optional(),
  tag: tag.optional(),
  frontmatter: z.strictObject({ key: z.string().min(1).max(CONTROL_LIMITS.identifierChars), value: z.union([z.string().max(CONTROL_LIMITS.literalChars), z.number(), z.boolean()]) }).optional(),
});
const mask = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("remove-field"), field: z.enum(["title", "path", "tags", "frontmatter", "aliases"]) }),
  z.strictObject({ kind: z.literal("replace-literal"), from: z.string().min(1).max(CONTROL_LIMITS.literalChars), to: z.string().max(CONTROL_LIMITS.literalChars) }),
]);
const rule = z.strictObject({
  id: identifier,
  recipient: z.enum(["internal", "remote-model", "external-client"]),
  operation: z.enum(["read", "create", "update", "append-research"]),
  effect: z.enum(["allow", "deny", "mask"]),
  selector,
  masks: z.array(mask).min(1).max(CONTROL_LIMITS.masks).optional(),
}).superRefine((value, ctx) => {
  if ((value.effect === "mask") !== (value.masks !== undefined) || (value.effect === "mask" && value.operation !== "read")) ctx.addIssue({ code: "custom", message: "INVALID_MASK_RULE" });
  if ((value.recipient === "remote-model" && value.operation !== "read") || (value.recipient === "external-client" && !["read", "append-research"].includes(value.operation)) || (value.recipient === "internal" && value.operation === "append-research")) ctx.addIssue({ code: "custom", message: "INVALID_RECIPIENT_OPERATION" });
});

/** Frontmatter only. Markdown prose cannot add grants. Defaults concern reads only. */
export const SecurityRulesSchema = z.strictObject({
  version: z.literal(1),
  defaults: z.strictObject({ internal: z.enum(["allow", "deny"]), "remote-model": z.enum(["allow", "deny"]), "external-client": z.enum(["allow", "deny"]) }),
  rules: z.array(rule).max(CONTROL_LIMITS.rules),
}).superRefine((value, ctx) => {
  if (new Set(value.rules.map((item) => item.id)).size !== value.rules.length) ctx.addIssue({ code: "custom", path: ["rules"], message: "DUPLICATE_RULE_ID" });
});

export function parseSecurityRules(input: unknown): Result<SecurityRules> {
  const result = SecurityRulesSchema.safeParse(input);
  if (result.success) return ok({ ...result.data, rules: result.data.rules.map((rule) => ({
    id: rule.id, recipient: rule.recipient, operation: rule.operation, effect: rule.effect,
    selector: {
      ...(rule.selector.folder === undefined ? {} : { folder: rule.selector.folder }),
      ...(rule.selector.tag === undefined ? {} : { tag: rule.selector.tag }),
      ...(rule.selector.frontmatter === undefined ? {} : { frontmatter: rule.selector.frontmatter }),
    },
    ...(rule.masks === undefined ? {} : { masks: rule.masks }),
  })) });
  const issue = result.error.issues[0];
  return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid security frontmatter", detail: {
    issueCode: issue?.code === "custom" ? issue.message : "CONTROL_SCHEMA_INVALID",
    field: issue?.path.join(".") ?? "",
  } }));
}

/** Data validation is not authentication. Only trusted services mint access contexts. */
export const AccessContextSchema = z.discriminatedUnion("recipient", [
  z.strictObject({ recipient: z.literal("internal"), purpose: z.enum(["search", "chat", "research", "apply", "setup"]), policyHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ recipient: z.literal("remote-model"), purpose: z.enum(["search", "chat", "research"]), policyHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ recipient: z.literal("external-client"), purpose: z.enum(["query", "submit"]), policyHash: z.string().regex(/^[a-f0-9]{64}$/), clientId: z.string().min(1).max(CONTROL_LIMITS.identifierChars).regex(/^[a-zA-Z0-9-]+$/), capabilities: z.array(z.enum(["query-vault", "submit-research"])).max(2).refine((items) => new Set(items).size === items.length, "DUPLICATE_CAPABILITY") }),
]);
