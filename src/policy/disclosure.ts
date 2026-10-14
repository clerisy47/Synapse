import { bodyStartOffset, foldCase, type DocMeta, type Excerpt, type MaskAction } from "../core";

/** A projection has no navigable path or original source offsets. */
export interface DisclosureExcerpt {
  readonly title: string;
  readonly text: string;
  readonly heading?: string;
}

export function replaceLiterals(text: string, masks: readonly MaskAction[]): string {
  for (const mask of masks) {
    if (mask.kind === "replace-literal") text = text.split(mask.from).join(mask.to);
  }
  return text;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Field removal also removes known field values from other disclosed strings. */
export function removedValues(doc: DocMeta, frontmatter: Readonly<Record<string, unknown>>, masks: readonly MaskAction[]): string[] {
  const fields = new Set(masks.flatMap((m) => m.kind === "remove-field" ? [m.field] : []));
  const values: string[] = [];
  if (fields.has("path")) values.push(doc.ref.path, doc.folder, doc.ref.path.split("/").pop() ?? "", doc.title);
  if (fields.has("title")) values.push(doc.title);
  if (fields.has("tags")) values.push(...doc.tags.flatMap((tag) => [`#${tag}`, tag]));
  if (fields.has("aliases")) values.push(...doc.aliases);
  if (fields.has("frontmatter")) values.push(...strings(frontmatter));
  return [...new Set(values.filter(Boolean))].sort((a, b) => b.length - a.length);
}

export function redactValues(text: string, values: readonly string[]): string {
  for (const value of values) {
    if (!value) continue;
    const needle = foldCase(value);
    let at = foldCase(text).indexOf(needle);
    while (at >= 0) {
      text = text.slice(0, at) + text.slice(at + value.length);
      at = foldCase(text).indexOf(needle);
    }
  }
  return text;
}

/** Source offsets remain on the private excerpt, never on the transformed view. */
export function projectDisclosure(excerpt: Excerpt, doc: DocMeta, frontmatter: Readonly<Record<string, unknown>>, source: string, masks: readonly MaskAction[]): DisclosureExcerpt {
  const removed = new Set(masks.flatMap((m) => m.kind === "remove-field" ? [m.field] : []));
  const values = removedValues(doc, frontmatter, masks);
  const clean = (text: string) => redactValues(replaceLiterals(redactValues(text, values), masks), values);
  const start = removed.has("frontmatter") || removed.has("tags") || removed.has("aliases")
    ? Math.max(excerpt.locator.start, bodyStartOffset(source)) : excerpt.locator.start;
  const text = clean(source.slice(start, excerpt.locator.end));
  const title = removed.has("title") || removed.has("path") ? "" : clean(doc.title);
  const heading = excerpt.locator.heading === undefined ? undefined : clean(excerpt.locator.heading);
  return { title, text, ...(heading === undefined ? {} : { heading }) };
}
