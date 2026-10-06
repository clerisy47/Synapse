#!/usr/bin/env node
/**
 * Fail the build if any model-output JSON Schema uses keywords outside
 * DESIGN §5.5 (ADR-12). Bundles src/llm/schemas.ts with esbuild then imports.
 */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "src/llm/schemas.ts");

const tmp = await mkdtemp(path.join(tmpdir(), "synapse-schema-subset-"));
const outfile = path.join(tmp, "schemas.cjs");

try {
  await build({
    entryPoints: [ENTRY],
    bundle: true,
    outfile,
    format: "cjs",
    platform: "node",
    target: "es2020",
    logLevel: "silent",
  });

  const require = createRequire(import.meta.url);
  const mod = require(outfile);
  const assertAllSchemasInSubset = mod.assertAllSchemasInSubset;
  const MODEL_OUTPUT_JSON_SCHEMAS = mod.MODEL_OUTPUT_JSON_SCHEMAS;

  if (typeof assertAllSchemasInSubset !== "function") {
    console.error("check-schema-subset: assertAllSchemasInSubset missing from bundle");
    process.exit(1);
  }
  if (!MODEL_OUTPUT_JSON_SCHEMAS || typeof MODEL_OUTPUT_JSON_SCHEMAS !== "object") {
    console.error("check-schema-subset: MODEL_OUTPUT_JSON_SCHEMAS missing from bundle");
    process.exit(1);
  }

  const kinds = Object.keys(MODEL_OUTPUT_JSON_SCHEMAS);
  if (kinds.length !== 7) {
    console.error(`check-schema-subset: expected 7 schemas, got ${kinds.length}: ${kinds.join(", ")}`);
    process.exit(1);
  }

  assertAllSchemasInSubset(MODEL_OUTPUT_JSON_SCHEMAS);
  console.log(`check-schema-subset: ok (${kinds.length} schemas)`);
} catch (err) {
  console.error("check-schema-subset: failed");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
