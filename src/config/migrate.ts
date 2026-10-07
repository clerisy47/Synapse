/**
 * Settings-shape migrations (stub).
 * Distinct from state/migrate.ts — runs before tolerant settings parse.
 */

/**
 * Identity migration until a settings-shape bump needs transforms.
 * Never throws; unknown input is returned unchanged for parseSettings to handle.
 */
export function migrateSettings(raw: unknown): unknown {
  return raw;
}
