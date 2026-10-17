/**
 * Model-output schemas (DESIGN §5.5, ADR-12).
 * Zod is the single source; provider JSON Schema is emitted via a subset-safe walker.
 */

import { NOTE_METADATA_LIMITS } from "../core";
import { z } from "zod";
import { CONTROL_LIMITS, PROPOSAL_LIMITS } from "../constants";

/** Prompt kinds that produce structured model output (DESIGN §5.4). */
export type PromptKind =
  | "health"
  | "qa.plan"
  | "qa.select"
  | "qa.answer"
  | "research.propose"
  | "metadata.propose";

/** JSON Schema keywords allowed for provider `format` (DESIGN §5.5). */
export const ALLOWED_JSON_SCHEMA_KEYWORDS = [
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "minItems",
  "maxItems",
  "maxLength",
  "additionalProperties",
] as const;

export type AllowedJsonSchemaKeyword = (typeof ALLOWED_JSON_SCHEMA_KEYWORDS)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_JSON_SCHEMA_KEYWORDS);

/** Ledger excerpt IDs are plain strings in the grammar (no `pattern`). */
const excerptIdSchema = z.string();

export const healthOutputSchema = z.object({
  ok: z.boolean(),
});

const planSearchSchema = z.object({
  tool: z.enum(["search_text", "search_by_title", "search_by_tag", "list_recent"]),
  terms: z.array(z.string()).max(6),
  phrases: z.array(z.string()).max(3),
  tag: z.string().nullable(),
  days: z.number().nullable(),
});

export const planOutputSchema = z.object({
  searches: z.array(planSearchSchema).min(1).max(4),
  expand_graph: z.boolean(),
});

export const selectOutputSchema = z.object({
  read: z.array(excerptIdSchema).max(4),
  enough: z.boolean(),
});

const answerClaimSchema = z.object({
  text: z.string(),
  sources: z.array(excerptIdSchema).min(1),
});

const followupSchema = z.object({
  terms: z.array(z.string()),
  phrases: z.array(z.string()),
});

export const answerOutputSchema = z.object({
  status: z.enum(["answered", "insufficient"]),
  claims: z.array(answerClaimSchema).max(8),
  followup: followupSchema.nullable(),
});

/** Model supplies text and plugin-issued IDs only; never paths or approval. */
export const proposalOutputSchema = z.strictObject({
  changes: z.array(z.strictObject({
    destinationId: z.string().max(CONTROL_LIMITS.identifierChars),
    markdown: z.string().max(PROPOSAL_LIMITS.entryChars),
    evidenceIds: z.array(z.string().max(CONTROL_LIMITS.identifierChars)).min(1).max(CONTROL_LIMITS.evidenceIds),
  })).min(1).max(PROPOSAL_LIMITS.targets),
});
export const metadataOutputSchema = z.strictObject({
  description: z.string().max(NOTE_METADATA_LIMITS.description),
  tags: z.array(z.string().max(NOTE_METADATA_LIMITS.tag)).min(1).max(NOTE_METADATA_LIMITS.tags),
  aliases: z.array(z.string().max(NOTE_METADATA_LIMITS.alias)).max(NOTE_METADATA_LIMITS.aliases),
});
export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

export type HealthOutput = z.infer<typeof healthOutputSchema>;
export type PlanOutput = z.infer<typeof planOutputSchema>;
export type SelectOutput = z.infer<typeof selectOutputSchema>;
export type AnswerOutput = z.infer<typeof answerOutputSchema>;

export const MODEL_OUTPUT_SCHEMAS = {
  "metadata.propose": metadataOutputSchema,
  health: healthOutputSchema,
  "qa.plan": planOutputSchema,
  "qa.select": selectOutputSchema,
  "qa.answer": answerOutputSchema,
  "research.propose": proposalOutputSchema,
} as const satisfies Record<PromptKind, z.ZodType>;

export type ProviderJsonSchema = {
  type?: string | string[];
  properties?: Record<string, ProviderJsonSchema>;
  required?: string[];
  items?: ProviderJsonSchema;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  additionalProperties?: false;
};

type ZodDef = {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  entries?: Record<string, string>;
  checks?: Array<{ check: string; maximum?: number; minimum?: number }>;
};

function zodDef(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/**
 * Emit provider JSON Schema using only the DESIGN §5.5 keyword subset.
 * Nullable objects become `type: ["object","null"]` (never `anyOf`/`oneOf`).
 */
export function emitProviderJsonSchema(schema: z.ZodType): ProviderJsonSchema {
  const def = zodDef(schema);

  switch (def.type) {
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: "number" };
    case "string": {
      const out: ProviderJsonSchema = { type: "string" };
      for (const check of def.checks ?? []) {
        if (check.check === "max_length" && check.maximum !== undefined) {
          out.maxLength = check.maximum;
        }
      }
      return out;
    }
    case "enum": {
      const values = Object.values(def.entries ?? {});
      return { type: "string", enum: values };
    }
    case "array": {
      if (!def.element) {
        throw new Error("array schema missing element");
      }
      const out: ProviderJsonSchema = {
        type: "array",
        items: emitProviderJsonSchema(def.element),
      };
      for (const check of def.checks ?? []) {
        if (check.check === "min_length" && check.minimum !== undefined) {
          out.minItems = check.minimum;
        }
        if (check.check === "max_length" && check.maximum !== undefined) {
          out.maxItems = check.maximum;
        }
      }
      return out;
    }
    case "object": {
      const shape = def.shape ?? {};
      const properties: Record<string, ProviderJsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        properties[key] = emitProviderJsonSchema(child);
        required.push(key);
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    case "nullable": {
      if (!def.innerType) {
        throw new Error("nullable schema missing innerType");
      }
      const inner = emitProviderJsonSchema(def.innerType);
      const innerType = inner.type;
      if (typeof innerType === "string") {
        return { ...inner, type: [innerType, "null"] };
      }
      if (Array.isArray(innerType)) {
        return {
          ...inner,
          type: innerType.includes("null") ? innerType : [...innerType, "null"],
        };
      }
      throw new Error("nullable inner schema has no type");
    }
    default:
      throw new Error(`Unsupported zod type for subset emitter: ${def.type}`);
  }
}

export const MODEL_OUTPUT_JSON_SCHEMAS: Record<PromptKind, ProviderJsonSchema> = {
  "metadata.propose": emitProviderJsonSchema(metadataOutputSchema),
  health: emitProviderJsonSchema(healthOutputSchema),
  "qa.plan": emitProviderJsonSchema(planOutputSchema),
  "qa.select": emitProviderJsonSchema(selectOutputSchema),
  "qa.answer": emitProviderJsonSchema(answerOutputSchema),
  "research.propose": emitProviderJsonSchema(proposalOutputSchema),
};

/**
 * Collect JSON Schema keyword names from a provider schema tree.
 * Keys under `properties` are field names, not keywords — only nested schemas are walked.
 */
export function collectJsonSchemaKeywords(node: unknown, into = new Set<string>()): Set<string> {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return into;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    into.add(key);
  }
  if (obj.properties && typeof obj.properties === "object" && !Array.isArray(obj.properties)) {
    for (const propSchema of Object.values(obj.properties as Record<string, unknown>)) {
      collectJsonSchemaKeywords(propSchema, into);
    }
  }
  if (obj.items !== undefined) {
    collectJsonSchemaKeywords(obj.items, into);
  }
  return into;
}

export function schemaSubsetViolations(schema: ProviderJsonSchema): string[] {
  const keywords = collectJsonSchemaKeywords(schema);
  const violations: string[] = [];
  for (const key of keywords) {
    if (!ALLOWED_SET.has(key)) {
      violations.push(key);
    }
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    violations.push("additionalProperties:!false");
  }
  return violations.sort();
}

export function assertAllSchemasInSubset(
  schemas: Record<string, ProviderJsonSchema> = MODEL_OUTPUT_JSON_SCHEMAS,
): void {
  const problems: string[] = [];
  for (const [kind, schema] of Object.entries(schemas)) {
    const violations = schemaSubsetViolations(schema);
    if (violations.length > 0) {
      problems.push(`${kind}: ${violations.join(", ")}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`JSON Schema subset violations:\n${problems.join("\n")}`);
  }
}
