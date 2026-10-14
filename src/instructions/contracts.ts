import { z } from "zod";
import { CONTROL_LIMITS } from "../constants";
import { err, ok, synapseError, validateVaultPath, type Result, type RoutingSettings, type VaultPath } from "../core";

const identifier = z.string().min(1).max(CONTROL_LIMITS.identifierChars).regex(/^[a-z][a-z0-9-]*$/);
const path = (kind: "markdown" | "folder") => z.string().max(CONTROL_LIMITS.pathChars).transform((value, ctx) => {
  const result = validateVaultPath(value, kind);
  if (!result.ok) { ctx.addIssue({ code: "custom", message: "INVALID_VAULT_PATH" }); return z.NEVER; }
  return result.value;
});
const timezone = z.string().min(1).max(CONTROL_LIMITS.identifierChars).refine((value) => {
  if (value !== "UTC" && (!value.includes("/") || !new RegExp("^[A-Za-z0-9_+/-]+$").test(value))) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "INVALID_TIMEZONE");

export const RoutingSettingsSchema = z.strictObject({
  version: z.literal(1),
  timezone,
  destinations: z.array(z.strictObject({ id: identifier, path: path("markdown") })).max(CONTROL_LIMITS.destinations),
  daily: z.strictObject({ id: identifier, folder: path("folder"), filename: z.literal("YYYY-MM-DD.md"), heading: z.string().min(1).max(CONTROL_LIMITS.headingChars).regex(/^#{1,6} [^\r\n]+$/) }),
}).superRefine((value, ctx) => {
  const ids = [...value.destinations.map((destination) => destination.id), value.daily.id];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "DUPLICATE_DESTINATION_ID" });
  const paths = value.destinations.map((destination) => destination.path.toLowerCase());
  if (new Set(paths).size !== paths.length) ctx.addIssue({ code: "custom", message: "DESTINATION_PATH_COLLISION" });
});

export function parseRoutingSettings(input: unknown): Result<RoutingSettings> {
  const result = RoutingSettingsSchema.safeParse(input);
  if (result.success) return ok(result.data);
  const issue = result.error.issues[0];
  return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid instruction frontmatter", detail: { issueCode: issue?.code === "custom" ? issue.message : "CONTROL_SCHEMA_INVALID", field: issue?.path.join(".") ?? "" } }));
}

/** An explicit calendar date only; interpretation of user prose belongs to R2-T02. */
export function resolveDailyDestination(routing: RoutingSettings, date: string): Result<VaultPath> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Resolve an explicit date before routing", detail: { issueCode: "AMBIGUOUS_DATE" } }));
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return err(synapseError({ code: "SCHEMA_INVALID", retryable: false, message: "Invalid calendar date", detail: { issueCode: "INVALID_DATE" } }));
  return validateVaultPath(`${routing.daily.folder}/${date}.md`);
}
