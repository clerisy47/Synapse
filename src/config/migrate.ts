/** Settings migrations applied before tolerant parsing. */
import { DEFAULT_OPENROUTER_MODEL } from "../constants";

/** Replace the retired Phase A default without mutating persisted input. */
export function migrateSettings(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const settings = raw as Record<string, unknown>;
  if ((settings.provider === undefined || settings.provider === "openrouter") &&
      settings.model === "qwen/qwen3.8-27b:free") {
    return { ...settings, model: DEFAULT_OPENROUTER_MODEL };
  }
  return raw;
}
