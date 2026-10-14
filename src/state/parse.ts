/**
 * Tolerant PersistedState parse (DESIGN §4.3 / AC-M8.7).
 * Never throws; invalid fields fall back to defaults with warnings.
 */

import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../config";
import { STATE_SCHEMA_VERSION } from "../constants";
import { asVaultPath, type VaultPath } from "../core";

export interface PersistedState {
  schemaVersion: number;
  settings: Settings;
  settingsUpdatedAt: number;
  touchLog: Record<VaultPath, number>;
  [unknown: string]: unknown;
}

export interface ParsePersistedResult {
  state: PersistedState;
  warnings: string[];
}

const KNOWN_KEYS = new Set([
  "schemaVersion",
  "settings",
  "settingsUpdatedAt",
  // Retired keys are recognized only to drop them rather than preserve as unknown.
  "dismissals",
  "touchLog",
  "resurface",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    excludedFolders: [...settings.excludedFolders],
    excludedTags: [...settings.excludedTags],
    qa: { ...settings.qa },
  };
}

/** Default empty persisted state (no note content). */
export function defaultPersistedState(): PersistedState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: cloneSettings(DEFAULT_SETTINGS),
    settingsUpdatedAt: 0,
    touchLog: {},
  };
}

export const DEFAULT_PERSISTED_STATE: PersistedState = defaultPersistedState();

function parseSchemaVersion(value: unknown, warnings: string[]): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.trunc(value);
  }
  if (value !== undefined) {
    warnings.push("schemaVersion invalid; using STATE_SCHEMA_VERSION");
  }
  return STATE_SCHEMA_VERSION;
}

function parseSettingsUpdatedAt(value: unknown, warnings: string[]): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (value !== undefined) {
    warnings.push("settingsUpdatedAt invalid; using 0");
  }
  return 0;
}

function parseTouchLog(
  raw: unknown,
  warnings: string[],
): Record<VaultPath, number> {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    warnings.push("touchLog invalid; using empty map");
    return {};
  }
  const out: Record<VaultPath, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[asVaultPath(key)] = Math.trunc(value);
    } else {
      warnings.push(`touchLog[${key}] invalid; skipped`);
    }
  }
  return out;
}

/**
 * Tolerant parse of `data.json`. Never throws.
 * Unknown top-level keys are preserved verbatim (AC-M8.7).
 */
export function parsePersisted(raw: unknown): ParsePersistedResult {
  const warnings: string[] = [];

  if (raw === null || raw === undefined) {
    return { state: defaultPersistedState(), warnings };
  }

  if (!isPlainObject(raw)) {
    warnings.push("root not an object; using defaults");
    return { state: defaultPersistedState(), warnings };
  }

  const state: PersistedState = {
    schemaVersion: parseSchemaVersion(raw.schemaVersion, warnings),
    settings: parseSettings(raw.settings ?? DEFAULT_SETTINGS),
    settingsUpdatedAt: parseSettingsUpdatedAt(raw.settingsUpdatedAt, warnings),
    touchLog: parseTouchLog(raw.touchLog, warnings),
  };

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      state[key] = value;
    }
  }

  return { state, warnings };
}
