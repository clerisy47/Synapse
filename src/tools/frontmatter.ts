/**
 * get_frontmatter tool (DESIGN §5.4) — MetadataPort JSON, strings clipped to 200.
 */

import { synapseError, type VaultPath } from "../core";
import { clipFrontmatterString, type GetFrontmatterArgs } from "./args";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

export interface GetFrontmatterPathResult {
  path: VaultPath;
  frontmatter: Record<string, unknown>;
}

export interface GetFrontmatterResult {
  results: GetFrontmatterPathResult[];
}

function notFound(): ToolOutcome<never> {
  return {
    ok: false,
    error: synapseError({
      code: "NOT_FOUND",
      message: "note not found",
      remediation: "NOT_FOUND",
    }),
  };
}

/** Deep-clip string leaves into a new tree (never mutates source). */
export function clipFrontmatterValue(value: unknown): unknown {
  if (typeof value === "string") {
    return clipFrontmatterString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => clipFrontmatterValue(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = clipFrontmatterValue(v);
    }
    return out;
  }
  return value;
}

function selectKeys(
  fm: Record<string, unknown>,
  keys: string[] | undefined,
): Record<string, unknown> {
  if (keys === undefined) {
    return fm;
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(fm, key)) {
      out[key] = fm[key];
    }
  }
  return out;
}

export function createGetFrontmatterHandler(
  deps: CoreToolDeps,
): ToolHandler<"get_frontmatter"> {
  return async (args: GetFrontmatterArgs): Promise<ToolOutcome<GetFrontmatterResult>> => {
    const results: GetFrontmatterPathResult[] = [];
    for (const path of args.paths) {
      const doc = deps.getDoc(path);
      if (!doc) {
        return notFound();
      }
      const raw = deps.getFrontmatter(path);
      if (raw === null) {
        return notFound();
      }
      const selected = selectKeys(raw, args.keys);
      results.push({
        path,
        frontmatter: clipFrontmatterValue(selected) as Record<string, unknown>,
      });
    }
    return { ok: true, data: { results }, truncated: false };
  };
}
