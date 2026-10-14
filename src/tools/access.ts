import { synapseError, type VaultPath } from "../core";
import type { CoreToolDeps } from "./deps";
import type { ToolRegistry } from "./registry";

/** Trusted injected authorization; never constructed from tool/model arguments. */
export interface ToolReadAccess {
  current(): boolean;
  allows(path: VaultPath): boolean;
  remember?(path: VaultPath, text: string): void;
}

/** Private retrieval facade. Path-bearing outputs require raw-tool permission. */
export function bindToolAccess(raw: CoreToolDeps, access: ToolReadAccess): CoreToolDeps {
  const allowed = (path: VaultPath) => access.current() && access.allows(path);
  const filter = (paths: readonly VaultPath[]) => paths.filter(allowed);
  return {
    ...raw,
    getDoc: (path) => allowed(path) ? raw.getDoc(path) : null,
    listDocs: () => raw.listDocs().filter((doc) => allowed(doc.ref.path)),
    async scanText(opts) {
      const scan = await raw.scanText(opts);
      if (!access.current()) return { hits: [], truncated: false };
      return { hits: scan.hits.filter((hit) => allowed(hit.path)), truncated: false };
    },
    searchTitles: (query) => raw.searchTitles(query).filter((hit) => allowed(hit.path)),
    async readText(path) {
      if (!allowed(path)) throw new Error("note not found");
      const text = await raw.readText(path);
      if (!allowed(path)) throw new Error("note not found");
      access.remember?.(path, text);
      return text;
    },
    outgoing: (path) => allowed(path) ? filter(raw.outgoing(path)) : [],
    incoming: (path) => allowed(path) ? filter(raw.incoming(path)) : [],
    // Unresolved/hidden neighbors must not be distinguishable by count.
    unresolvedCount: () => 0,
    pathsForTag: (tag, opts) => filter(raw.pathsForTag(tag, opts)),
    getFrontmatter: (path) => allowed(path) ? raw.getFrontmatter(path) : null,
    lastTouchedAt: (path) => allowed(path) ? raw.lastTouchedAt(path) : undefined,
  };
}

/** No stale outcome may cross the tool facade after an asynchronous handler. */
export function guardToolRegistry(registry: ToolRegistry, access: ToolReadAccess): ToolRegistry {
  const denied = () => ({ ok: false as const, error: synapseError({ code: "NOT_FOUND", message: "note not found", remediation: "NOT_FOUND" }) });
  return {
    canonicalKey: (name, args) => registry.canonicalKey(name, args),
    async invoke(name, args, ctx) {
      if (!access.current() || ctx.signal.aborted) return denied();
      const result = await registry.invoke(name, args, ctx);
      return access.current() && !ctx.signal.aborted ? result : denied();
    },
  };
}

/** Citation verification uses original text with the same before/after read gates. */
export function createPermittedTextReader(raw: CoreToolDeps, access: ToolReadAccess): (path: VaultPath) => Promise<string | null> {
  const deps = bindToolAccess(raw, access);
  return async (path) => {
    try { return await deps.readText(path); } catch { return null; }
  };
}
