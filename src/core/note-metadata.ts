import { parseDocument, isMap } from "yaml";
import type { DocMeta } from "./types";
import { bodyStartOffset } from "./text";

/** Product bounds, shared by audit, proposals and retrieval. UTF-16 characters. */
export const NOTE_METADATA_LIMITS = Object.freeze({ description: 240, tag: 64, tags: 12, alias: 80, aliases: 12, frontmatter: 16384, proposalBody: 6000, outputTokens: 512 });
export interface RequiredNoteMetadata { description: string; tags: string[]; aliases: string[] }
export type MetadataField = keyof RequiredNoteMetadata;
export interface MetadataIssue { field: MetadataField | "frontmatter"; reason: "missing" | "invalid" }
export function metadataIssues(value: Record<string, unknown>): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  for (const field of ["description", "tags", "aliases"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) { issues.push({ field, reason: "missing" }); continue; }
    const raw = value[field];
    const validString = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max && ![...s].some((c) => c.charCodeAt(0) < 32);
    const valid = field === "description" ? validString(raw, NOTE_METADATA_LIMITS.description)
      : Array.isArray(raw) && raw.length >= (field === "tags" ? 1 : 0) && raw.length <= NOTE_METADATA_LIMITS[field]
        && raw.every((s) => validString(s, field === "tags" ? NOTE_METADATA_LIMITS.tag : NOTE_METADATA_LIMITS.alias));
    if (!valid) issues.push({ field, reason: "invalid" });
  }
  return issues;
}
/** Strict YAML, bounded expansion, duplicate keys rejected. No code execution. */
export function parseNoteFrontmatter(text: string): { value: Record<string, unknown>; issues: MetadataIssue[]; end: number } {
  const end = bodyStartOffset(text);
  const opens = /^\uFEFF?---(?:\r?\n|$)/.test(text);
  if (!end) return { value: {}, issues: opens ? [{ field: "frontmatter", reason: "invalid" }] : metadataIssues({}), end: 0 };
  if (end > NOTE_METADATA_LIMITS.frontmatter) return { value: {}, issues: [{ field: "frontmatter", reason: "invalid" }], end };
  try {
    const yaml = text.slice(text.indexOf("\n") + 1, text.lastIndexOf("---", end - 1));
    const doc = parseDocument(yaml, { uniqueKeys: true, schema: "core" });
    if (doc.errors.length || doc.warnings.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error("Invalid frontmatter");
    const value = (doc.toJS({ maxAliasCount: 32 }) ?? {}) as Record<string, unknown>;
    return { value, issues: metadataIssues(value), end };
  } catch { return { value: {}, issues: [{ field: "frontmatter", reason: "invalid" }], end }; }
}
/** Append missing keys only: existing YAML bytes, comments and body stay exact. */
export function proposeMissingMetadata(text: string, suggestion: RequiredNoteMetadata): string | null {
  const parsed = parseNoteFrontmatter(text);
  if (metadataIssues(suggestion as unknown as Record<string, unknown>).length || parsed.issues.some((i) => i.reason !== "missing")) return null;
  const missing = parsed.issues.map((i) => i.field);
  if (!missing.length) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const additions = missing.map((field) => `${field}: ${JSON.stringify(suggestion[field as MetadataField])}${eol}`).join("");
  if (!parsed.end) return `---${eol}${additions}---${eol}${text}`;
  const close = text.lastIndexOf("---", parsed.end - 1);
  return text.slice(0, close) + additions + text.slice(close);
}

/** Compact, untrusted discovery data; never citation evidence or authority. */
export function compactNoteMetadata(doc: DocMeta): RequiredNoteMetadata {
  return { description: (doc.description ?? "").slice(0, NOTE_METADATA_LIMITS.description),
    tags: doc.tags.slice(0, NOTE_METADATA_LIMITS.tags).map((t) => t.slice(0, NOTE_METADATA_LIMITS.tag)),
    aliases: doc.aliases.slice(0, NOTE_METADATA_LIMITS.aliases).map((a) => a.slice(0, NOTE_METADATA_LIMITS.alias)) };
}
