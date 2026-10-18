/** Settings migrations applied before tolerant parsing. */
import { DEFAULT_OPENROUTER_MODEL, DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } from "../constants";

/** Replace the retired Phase A default without mutating persisted input. */
export function migrateSettings(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const settings = raw as Record<string, unknown>;
  // Upgrade the retired local alias; preserve explicit remote/custom selections.
  if (settings.provider === "bonsai" && settings.model === "bonsai-2-4b") {
    return { ...settings, model: DEFAULT_BONSAI_MODEL };
  }
  // Only legacy defaults migrate. Explicit custom cloud models stay selected.
  if (settings.providerRevision !== 1 && (settings.provider === undefined || settings.provider === "openrouter") &&
      (settings.model === undefined || settings.model === "openrouter/free" || settings.model === "qwen/qwen3.8-27b:free") &&
      (settings.endpoint === undefined || settings.endpoint === "https://openrouter.ai/api/v1")) {
    return { ...settings, provider: "bonsai", endpoint: DEFAULT_BONSAI_ENDPOINT,
      model: DEFAULT_BONSAI_MODEL, endpointAckHost: null, transport: "node", numCtx: 4096 };
  }
  if ((settings.provider === undefined || settings.provider === "openrouter") &&
      settings.model === "qwen/qwen3.8-27b:free") {
    return { ...settings, model: DEFAULT_OPENROUTER_MODEL };
  }
  return raw;
}
