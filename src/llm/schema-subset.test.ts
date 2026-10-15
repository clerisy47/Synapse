import { describe, expect, it } from "vitest";
import {
  ALLOWED_JSON_SCHEMA_KEYWORDS,
  MODEL_OUTPUT_JSON_SCHEMAS,
  MODEL_OUTPUT_SCHEMAS,
  assertAllSchemasInSubset,
  collectJsonSchemaKeywords,
  emitProviderJsonSchema,
  healthOutputSchema,
  planOutputSchema,
  schemaSubsetViolations,
} from "./index";
import * as llmPublic from "./index";

const PROMPT_KINDS = [
  "health",
  "qa.plan",
  "qa.select",
  "qa.answer",
  "research.propose",
] as const;

describe("model-output schemas", () => {
  it("registers health, Q&A and research prompt kinds", () => {
    expect(Object.keys(MODEL_OUTPUT_SCHEMAS).sort()).toEqual([...PROMPT_KINDS].sort());
    expect(Object.keys(MODEL_OUTPUT_JSON_SCHEMAS).sort()).toEqual([...PROMPT_KINDS].sort());
  });

  it("accepts valid health output", () => {
    expect(healthOutputSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it("rejects invalid health output", () => {
    expect(() => healthOutputSchema.parse({ ok: "yes" })).toThrow();
    expect(() => healthOutputSchema.parse({})).toThrow();
  });

  it("accepts a valid plan with nullables", () => {
    const value = planOutputSchema.parse({
      searches: [
        {
          tool: "search_by_tag",
          terms: ["a"],
          phrases: [],
          tag: "inbox",
          days: null,
        },
      ],
      expand_graph: false,
    });
    expect(value.searches[0]?.tag).toBe("inbox");
    expect(value.searches[0]?.days).toBeNull();
  });

  it("rejects plan searches outside bounds", () => {
    expect(() =>
      planOutputSchema.parse({
        searches: [],
        expand_graph: false,
      }),
    ).toThrow();
  });

  it("rejects answer claims without sources", () => {
    expect(() =>
      MODEL_OUTPUT_SCHEMAS["qa.answer"].parse({
        status: "answered",
        claims: [{ text: "x", sources: [] }],
        followup: null,
      }),
    ).toThrow();
  });

  it("rejects answer arrays above the claim cap", () => {
    expect(() => MODEL_OUTPUT_SCHEMAS["qa.answer"].parse({
      status: "answered", claims: Array.from({ length: 9 }, () => ({ text: "x", sources: ["E1"] })), followup: null,
    })).toThrow();
  });

  it("rejects unknown answer statuses", () => {
    expect(() => MODEL_OUTPUT_SCHEMAS["qa.answer"].parse({ status: "maybe", claims: [], followup: null })).toThrow();
  });
});

describe("provider JSON Schema subset", () => {
  it("emits only allowed keywords for every kind", () => {
    expect(() => assertAllSchemasInSubset()).not.toThrow();
    for (const kind of PROMPT_KINDS) {
      const keywords = collectJsonSchemaKeywords(MODEL_OUTPUT_JSON_SCHEMAS[kind]);
      for (const key of keywords) {
        expect(ALLOWED_JSON_SCHEMA_KEYWORDS).toContain(key);
      }
      expect(schemaSubsetViolations(MODEL_OUTPUT_JSON_SCHEMAS[kind])).toEqual([]);
    }
  });

  it("encodes nullable object followup without anyOf/oneOf", () => {
    const schema = MODEL_OUTPUT_JSON_SCHEMAS["qa.answer"];
    const followup = schema.properties?.followup;
    expect(followup?.type).toEqual(["object", "null"]);
    expect(JSON.stringify(followup)).not.toMatch(/anyOf|oneOf|\$ref|pattern|"format"/);
  });

  it("encodes nullable string/number as type arrays", () => {
    const search = MODEL_OUTPUT_JSON_SCHEMAS["qa.plan"].properties?.searches?.items?.properties;
    expect(search?.tag?.type).toEqual(["string", "null"]);
    expect(search?.days?.type).toEqual(["number", "null"]);
  });

  it("sets additionalProperties false on objects", () => {
    expect(emitProviderJsonSchema(healthOutputSchema).additionalProperties).toBe(false);
  });
});

describe("public llm surface", () => {
  it("does not expose free-form parse helpers", () => {
    const names = Object.keys(llmPublic);
    expect(names).not.toContain("parseJson");
    expect(names).not.toContain("parseFreeForm");
    expect(names).not.toContain("looseParse");
    expect(names.some((n) => /json\.parse/i.test(n))).toBe(false);
  });
});
