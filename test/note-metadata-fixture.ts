import { parseNoteFrontmatter, proposeMissingMetadata } from "../src/core";
/** Explicit compliant synthetic note fixture. Tests for invalid metadata use raw text. */
export function withMetadata(text: string, fields: { description?: string; tags?: string[]; aliases?: string[] } = {}): string {
  const parsed = parseNoteFrontmatter(text);
  if (!parsed.issues.length) return text;
  const proposed = proposeMissingMetadata(text, { description: fields.description ?? "Synthetic note subject and scope.", tags: fields.tags ?? ["fixture"], aliases: fields.aliases ?? [] });
  if (proposed === null) throw Error("Invalid metadata fixture");
  return proposed;
}
