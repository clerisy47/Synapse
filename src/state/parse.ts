/**
 * Tolerant PersistedState parse (DESIGN §4.3 / AC-M8.7).
 * Never throws; invalid fields fall back to defaults with warnings.
 */

import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../config";
import { STATE_SCHEMA_VERSION } from "../constants";
import { asVaultPath, type VaultPath } from "../core";

export type DismissalKind = "flag" | "resurface";

export interface DismissalRecord {
  kind: DismissalKind;
  at: number;
  active: boolean;
  sourcePath?: VaultPath;
  otherPath?: VaultPath;
  claimHash?: string;
  groups?: string[];
}

export interface ResurfaceMarker {
  lastRunDay: string | null;
}

export interface PersistedState {
  schemaVersion: number;
  settings: Settings;
  settingsUpdatedAt: number;
  dismissals: Record<string, DismissalRecord>;
  touchLog: Record<VaultPath, number>;
  resurface: ResurfaceMarker;
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
  "dismissals",
  "touchLog",
  "resurface",
]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    excludedFolders: [...settings.excludedFolders],
    excludedTags: [...settings.excludedTags],
    qa: { ...settings.qa },
    contradiction: {
      onIdle: { ...settings.contradiction.onIdle },
    },
    resurface: { ...settings.resurface },
  };
}

/** Default empty persisted state (no note content). */
export function defaultPersistedState(): PersistedState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: cloneSettings(DEFAULT_SETTINGS),
    settingsUpdatedAt: 0,
    dismissals: {},
    touchLog: {},
    resurface: { lastRunDay: null },
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

function parseOptionalPath(
  value: unknown,
  field: string,
  warnings: string[],
): VaultPath | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length > 0) {
    return asVaultPath(value);
  }
  warnings.push(`dismissal.${field} invalid; dropped`);
  return undefined;
}

function parseDismissalRecord(
  key: string,
  raw: unknown,
  warnings: string[],
): DismissalRecord | null {
  if (!isPlainObject(raw)) {
    warnings.push(`dismissals[${key}] not an object; skipped`);
    return null;
  }

  const kind = raw.kind;
  if (kind !== "flag" && kind !== "resurface") {
    warnings.push(`dismissals[${key}].kind invalid; skipped`);
    return null;
  }

  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) {
    warnings.push(`dismissals[${key}].at invalid; skipped`);
    return null;
  }

  if (typeof raw.active !== "boolean") {
    warnings.push(`dismissals[${key}].active invalid; skipped`);
    return null;
  }

  const record: DismissalRecord = {
    kind,
    at: Math.trunc(raw.at),
    active: raw.active,
  };

  const sourcePath = parseOptionalPath(raw.sourcePath, "sourcePath", warnings);
  if (sourcePath !== undefined) record.sourcePath = sourcePath;

  const otherPath = parseOptionalPath(raw.otherPath, "otherPath", warnings);
  if (otherPath !== undefined) record.otherPath = otherPath;

  if (raw.claimHash !== undefined) {
    if (typeof raw.claimHash === "string") {
      record.claimHash = raw.claimHash;
    } else {
      warnings.push(`dismissals[${key}].claimHash invalid; dropped`);
    }
  }

  if (raw.groups !== undefined) {
    if (Array.isArray(raw.groups)) {
      record.groups = raw.groups.filter(
        (g): g is string => typeof g === "string",
      );
    } else {
      warnings.push(`dismissals[${key}].groups invalid; dropped`);
    }
  }

  return record;
}

function parseDismissals(
  raw: unknown,
  warnings: string[],
): Record<string, DismissalRecord> {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) {
    warnings.push("dismissals invalid; using empty map");
    return {};
  }
  const out: Record<string, DismissalRecord> = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = parseDismissalRecord(key, value, warnings);
    if (record !== null) out[key] = record;
  }
  return out;
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

function parseLastRunDay(value: unknown, warnings: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && DAY_RE.test(value)) return value;
  warnings.push("resurface.lastRunDay invalid; using null");
  return null;
}

function parseResurface(raw: unknown, warnings: string[]): ResurfaceMarker {
  if (raw === undefined) return { lastRunDay: null };
  if (!isPlainObject(raw)) {
    warnings.push("resurface invalid; using defaults");
    return { lastRunDay: null };
  }
  return { lastRunDay: parseLastRunDay(raw.lastRunDay, warnings) };
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
    dismissals: parseDismissals(raw.dismissals, warnings),
    touchLog: parseTouchLog(raw.touchLog, warnings),
    resurface: parseResurface(raw.resurface, warnings),
  };

  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      state[key] = value;
    }
  }

  return { state, warnings };
}
