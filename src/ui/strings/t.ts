/**
 * Tiny string lookup helper (DESIGN §7 / OQ-15).
 */

/** Replace `{name}` placeholders; unknown keys left as-is. */
export function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined ? match : String(v);
  });
}
