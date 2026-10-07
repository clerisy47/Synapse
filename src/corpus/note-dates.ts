/**
 * Note date resolution shared by flags (F-16) and resurfacing (AC-M7.3).
 * Frontmatter field parse for resurface.dateField fallback — not a full FM index.
 */

export type NoteDateMode = "mtime" | { field: string };

export interface ResolveNoteDateInput {
  mtime: number;
  frontmatter: Record<string, unknown>;
  mode: NoteDateMode;
}

/**
 * Parse a frontmatter date value to epoch ms.
 * Accepts ISO date/datetime strings and finite numbers (epoch ms).
 */
export function parseFrontmatterDate(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Bare YYYY-MM-DD → UTC midnight so date-only strings are stable.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    const ms = Date.UTC(y, m - 1, d);
    const check = new Date(ms);
    if (
      check.getUTCFullYear() !== y ||
      check.getUTCMonth() !== m - 1 ||
      check.getUTCDate() !== d
    ) {
      return null;
    }
    return ms;
  }
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return null;
  }
  return ms;
}

/**
 * Resolve a note's effective date.
 * - `mtime` mode → always `mtime`
 * - `{ field }` → parse frontmatter[field], or null if missing/invalid
 */
export function resolveNoteDate(input: ResolveNoteDateInput): number | null {
  if (input.mode === "mtime") {
    return input.mtime;
  }
  const key = input.mode.field;
  if (key.length === 0) {
    return null;
  }
  // Case-insensitive key match (Obsidian frontmatter keys vary in casing).
  const want = key.toLowerCase();
  for (const [k, v] of Object.entries(input.frontmatter)) {
    if (k.toLowerCase() === want) {
      return parseFrontmatterDate(v);
    }
  }
  return null;
}

export type NoteDateResolver = (input: ResolveNoteDateInput) => number | null;

export function createNoteDateResolver(): NoteDateResolver {
  return resolveNoteDate;
}
