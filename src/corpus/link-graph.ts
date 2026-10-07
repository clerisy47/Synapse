/**
 * Forward + inverse link graph from MetadataPort.resolvedLinks (DESIGN §4.2 / ADR-07).
 * Excluded endpoints are dropped via caller-supplied `allowed` (OQ-11).
 * Never uses getBacklinksForFile (OQ-2 / R9).
 */

import { asVaultPath, type VaultPath } from "../core";

export interface LinkGraph {
  /** Full rebuild; only edges with both ends in `allowed`. */
  rebuild(
    resolvedLinks: Record<string, Record<string, number>>,
    allowed: ReadonlySet<string>,
  ): void;
  /** Incremental: replace one source’s outbound edges (`null` clears that source). */
  updateSource(
    source: VaultPath,
    targets: Record<string, number> | null,
    allowed: ReadonlySet<string>,
  ): void;
  /** Drop path as source and as target everywhere. */
  remove(path: VaultPath): void;
  outgoing(path: VaultPath): readonly VaultPath[];
  incoming(path: VaultPath): readonly VaultPath[];
  clear(): void;
}

function normalize(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

/** Unique targets with count > 0 and both ends allowed; sorted for determinism. */
function filterTargets(
  source: VaultPath,
  targets: Record<string, number> | null | undefined,
  allowed: ReadonlySet<string>,
): VaultPath[] {
  if (!targets || !allowed.has(source)) {
    return [];
  }
  const out: VaultPath[] = [];
  for (const [raw, count] of Object.entries(targets)) {
    if (count <= 0) {
      continue;
    }
    const target = normalize(raw);
    if (!allowed.has(target)) {
      continue;
    }
    out.push(target);
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Deduplicate after normalize (rare path aliasing).
  const unique: VaultPath[] = [];
  for (const t of out) {
    if (unique.length === 0 || unique[unique.length - 1] !== t) {
      unique.push(t);
    }
  }
  return unique;
}

function removeFromList(list: VaultPath[], path: VaultPath): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === path) {
      list.splice(i, 1);
    }
  }
}

export function createLinkGraph(): LinkGraph {
  const forward = new Map<VaultPath, VaultPath[]>();
  const inverse = new Map<VaultPath, VaultPath[]>();

  function clearOutbound(source: VaultPath): void {
    const prev = forward.get(source);
    if (!prev) {
      return;
    }
    for (const target of prev) {
      const back = inverse.get(target);
      if (back) {
        removeFromList(back, source);
        if (back.length === 0) {
          inverse.delete(target);
        }
      }
    }
    forward.delete(source);
  }

  function setOutbound(source: VaultPath, targets: VaultPath[]): void {
    clearOutbound(source);
    if (targets.length === 0) {
      return;
    }
    forward.set(source, targets);
    for (const target of targets) {
      let back = inverse.get(target);
      if (!back) {
        back = [];
        inverse.set(target, back);
      }
      back.push(source);
      back.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
  }

  function rebuild(
    resolvedLinks: Record<string, Record<string, number>>,
    allowed: ReadonlySet<string>,
  ): void {
    forward.clear();
    inverse.clear();
    for (const [rawSource, targets] of Object.entries(resolvedLinks)) {
      const source = normalize(rawSource);
      const filtered = filterTargets(source, targets, allowed);
      if (filtered.length === 0) {
        continue;
      }
      forward.set(source, filtered);
      for (const target of filtered) {
        let back = inverse.get(target);
        if (!back) {
          back = [];
          inverse.set(target, back);
        }
        back.push(source);
      }
    }
    for (const back of inverse.values()) {
      back.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
  }

  function updateSource(
    source: VaultPath,
    targets: Record<string, number> | null,
    allowed: ReadonlySet<string>,
  ): void {
    const src = normalize(source);
    setOutbound(src, filterTargets(src, targets, allowed));
  }

  function remove(path: VaultPath): void {
    const p = normalize(path);
    clearOutbound(p);
    // Drop as target from every source.
    const sources = inverse.get(p);
    if (sources) {
      for (const source of [...sources]) {
        const outs = forward.get(source);
        if (outs) {
          removeFromList(outs, p);
          if (outs.length === 0) {
            forward.delete(source);
          }
        }
      }
      inverse.delete(p);
    }
  }

  function outgoing(path: VaultPath): readonly VaultPath[] {
    return forward.get(normalize(path)) ?? [];
  }

  function incoming(path: VaultPath): readonly VaultPath[] {
    return inverse.get(normalize(path)) ?? [];
  }

  function clear(): void {
    forward.clear();
    inverse.clear();
  }

  return { rebuild, updateSource, remove, outgoing, incoming, clear };
}
