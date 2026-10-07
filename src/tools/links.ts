/**
 * get_links / get_backlinks tools (DESIGN §5.4) — forward + inverse from LinkGraph.
 */

import { synapseError, type SourceRef, type VaultPath } from "../core";
import type { GetBacklinksArgs, GetLinksArgs } from "./args";
import type { CoreToolDeps } from "./deps";
import type { ToolHandler, ToolOutcome } from "./registry";

export interface GetLinksPathResult {
  path: VaultPath;
  outgoing: SourceRef[];
  unresolvedCount: number;
}

export interface GetLinksResult {
  results: GetLinksPathResult[];
}

export interface GetBacklinksPathResult {
  path: VaultPath;
  incoming: SourceRef[];
}

export interface GetBacklinksResult {
  results: GetBacklinksPathResult[];
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

function refsFromPaths(deps: CoreToolDeps, paths: readonly VaultPath[]): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const path of paths) {
    const doc = deps.getDoc(path);
    if (doc) {
      refs.push(doc.ref);
    }
  }
  return refs;
}

export function createGetLinksHandler(deps: CoreToolDeps): ToolHandler<"get_links"> {
  return async (args: GetLinksArgs): Promise<ToolOutcome<GetLinksResult>> => {
    const results: GetLinksPathResult[] = [];
    for (const path of args.paths) {
      const doc = deps.getDoc(path);
      if (!doc) {
        return notFound();
      }
      if (doc.ref.kind === "pdf") {
        results.push({ path, outgoing: [], unresolvedCount: 0 });
        continue;
      }
      results.push({
        path,
        outgoing: refsFromPaths(deps, deps.outgoing(path)),
        unresolvedCount: deps.unresolvedCount(path),
      });
    }
    return { ok: true, data: { results }, truncated: false };
  };
}

export function createGetBacklinksHandler(
  deps: CoreToolDeps,
): ToolHandler<"get_backlinks"> {
  return async (args: GetBacklinksArgs): Promise<ToolOutcome<GetBacklinksResult>> => {
    const results: GetBacklinksPathResult[] = [];
    for (const path of args.paths) {
      const doc = deps.getDoc(path);
      if (!doc) {
        return notFound();
      }
      const incoming = refsFromPaths(deps, deps.incoming(path)).slice(0, args.limit);
      results.push({ path, incoming });
    }
    return { ok: true, data: { results }, truncated: false };
  };
}
