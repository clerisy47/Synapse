/**
 * ExclusionPolicy — folder / tag / frontmatter, fail-closed (DESIGN §6.6 / F-22).
 * Pure decide(); corpus applies at ingest. Inject frontmatter key (no constants import).
 */

import type { SourceKind, VaultPath } from "../core";

export type ExclusionDecision = "allowed" | "excluded";

export interface ExclusionRules {
  folders: readonly string[];
  tags: readonly string[];
  /** Injected at compose time (EXCLUSION_FRONTMATTER_KEY). */
  frontmatterKey: string;
  /** Default "ignore" (EXCLUSION_FRONTMATTER_VALUE). */
  frontmatterValue?: string;
}

export interface ExclusionDecideOptions {
  kind?: SourceKind;
}

export interface ExclusionPolicy {
  decide(
    path: VaultPath,
    tags: readonly string[] | null,
    frontmatter: Record<string, unknown> | null,
    opts?: ExclusionDecideOptions,
  ): ExclusionDecision;
}

function normalizeFolderRule(rule: string): string {
  return rule.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** True if path equals folder or is a descendant (`Private` → `Private/a.md`). */
function matchesFolder(path: string, folderRule: string): boolean {
  const folder = normalizeFolderRule(folderRule);
  if (folder.length === 0) {
    return false;
  }
  const p = normalizePath(path);
  return p === folder || p.startsWith(`${folder}/`);
}

/** Exact tag or nested child (`private` → `private/x`, not `privateish`). */
function matchesTag(tag: string, rule: string): boolean {
  const t = tag.replace(/^#/, "");
  const r = rule.replace(/^#/, "");
  if (r.length === 0) {
    return false;
  }
  return t === r || t.startsWith(`${r}/`);
}

function frontmatterExcludes(
  frontmatter: Record<string, unknown>,
  key: string,
  value: string,
): boolean {
  const wantKey = key.toLowerCase();
  const wantValue = value.toLowerCase();
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k.toLowerCase() !== wantKey) {
      continue;
    }
    if (typeof v === "string" && v.toLowerCase() === wantValue) {
      return true;
    }
  }
  return false;
}

export function createExclusionPolicy(rules: ExclusionRules): ExclusionPolicy {
  const frontmatterValue = rules.frontmatterValue ?? "ignore";

  return {
    decide(path, tags, frontmatter, opts): ExclusionDecision {
      const kind = opts?.kind ?? "note";

      for (const folder of rules.folders) {
        if (matchesFolder(path, folder)) {
          return "excluded";
        }
      }

      // PDFs: folder exclusion only (F-22).
      if (kind === "pdf") {
        return "allowed";
      }

      // Fail-closed until metadata parsed (DESIGN §6.6).
      if (tags === null || frontmatter === null) {
        return "excluded";
      }

      for (const rule of rules.tags) {
        for (const tag of tags) {
          if (matchesTag(tag, rule)) {
            return "excluded";
          }
        }
      }

      if (
        frontmatterExcludes(frontmatter, rules.frontmatterKey, frontmatterValue)
      ) {
        return "excluded";
      }

      return "allowed";
    },
  };
}
