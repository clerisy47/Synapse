/**
 * Settings shape and tolerant parse (DESIGN §4.5 / §8.4).
 * Per-field fallback to defaults; numeric fields clamped to bounds.
 */

import { z } from "zod";

import type { LogLevel } from "../core";
import { DEFAULT_SETTINGS } from "./defaults";
import { migrateSettings } from "./migrate";

export type ProviderId = "openrouter" | "ollama";
export type TransportMode = "auto" | "node" | "requestUrl";

export interface QaSettings {
  multiTurn: boolean;
  maxHops: number;
  wallClockSec: number;
}

export interface ContradictionOnIdleSettings {
  enabled: boolean;
  debounceSec: number;
}

export interface ContradictionSettings {
  onIdle: ContradictionOnIdleSettings;
}

export interface ResurfaceSettings {
  enabled: boolean;
  staleDays: number;
  dateField: string;
}

export interface Settings {
  endpoint: string;
  provider: ProviderId;
  apiKey: string | null;
  endpointAckHost: string | null;
  model: string;
  numCtx: number;
  keepAlive: string;
  transport: TransportMode;
  excludedFolders: string[];
  excludedTags: string[];
  qa: QaSettings;
  contradiction: ContradictionSettings;
  resurface: ResurfaceSettings;
  logLevel: LogLevel;
}

/** Bounds for integer settings (DESIGN §4.5). */
export const SETTINGS_BOUNDS = {
  numCtx: { min: 2048, max: 8192 },
  qaMaxHops: { min: 2, max: 12 },
  qaWallClockSec: { min: 15, max: 180 },
  contradictionDebounceSec: { min: 30 },
  resurfaceStaleDays: { min: 7, max: 3650 },
} as const;

const providerSchema = z.enum(["openrouter", "ollama"]);
const transportSchema = z.enum(["auto", "node", "requestUrl"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

/** Strict schema for a fully normalized Settings object. */
export const settingsSchema: z.ZodType<Settings> = z.object({
  endpoint: z.string(),
  provider: providerSchema,
  apiKey: z.string().nullable(),
  endpointAckHost: z.string().nullable(),
  model: z.string(),
  numCtx: z.number().int(),
  keepAlive: z.string(),
  transport: transportSchema,
  excludedFolders: z.array(z.string()),
  excludedTags: z.array(z.string()),
  qa: z.object({
    multiTurn: z.boolean(),
    maxHops: z.number().int(),
    wallClockSec: z.number().int(),
  }),
  contradiction: z.object({
    onIdle: z.object({
      enabled: z.boolean(),
      debounceSec: z.number().int(),
    }),
  }),
  resurface: z.object({
    enabled: z.boolean(),
    staleDays: z.number().int(),
    dateField: z.string(),
  }),
  logLevel: logLevelSchema,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function clampInt(value: unknown, def: number, min: number, max?: number): number {
  const n = parseFiniteInt(value);
  if (n === null) return def;
  if (max === undefined) return Math.max(min, n);
  return Math.min(max, Math.max(min, n));
}

function parseEndpoint(value: unknown, def: string): string {
  if (typeof value !== "string" || value.trim() === "") return def;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return value;
  } catch {
    // fall through
  }
  return def;
}

function parseNullableString(value: unknown, def: string | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return def;
}

function parseString(value: unknown, def: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return def;
}

function parseBoolean(value: unknown, def: boolean): boolean {
  if (typeof value === "boolean") return value;
  return def;
}

function parseStringArray(value: unknown, def: string[]): string[] {
  if (!Array.isArray(value)) return def;
  return value.filter((item): item is string => typeof item === "string");
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  def: T,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return def;
}

/**
 * Tolerant settings parse: never throws.
 * Invalid fields fall back to defaults; in-range ints are clamped.
 */
export function parseSettings(raw: unknown): Settings {
  const migrated = migrateSettings(raw);
  if (!isPlainObject(migrated)) {
    return { ...cloneSettings(DEFAULT_SETTINGS) };
  }

  const d = DEFAULT_SETTINGS;
  const qaRaw = isPlainObject(migrated.qa) ? migrated.qa : {};
  const contradictionRaw = isPlainObject(migrated.contradiction)
    ? migrated.contradiction
    : {};
  const onIdleRaw = isPlainObject(contradictionRaw.onIdle)
    ? contradictionRaw.onIdle
    : {};
  const resurfaceRaw = isPlainObject(migrated.resurface) ? migrated.resurface : {};

  const parsed: Settings = {
    endpoint: parseEndpoint(migrated.endpoint, d.endpoint),
    provider: parseEnum(migrated.provider, ["openrouter", "ollama"], d.provider),
    apiKey: parseNullableString(migrated.apiKey, d.apiKey),
    endpointAckHost: parseNullableString(migrated.endpointAckHost, d.endpointAckHost),
    model: parseString(migrated.model, d.model),
    numCtx: clampInt(
      migrated.numCtx,
      d.numCtx,
      SETTINGS_BOUNDS.numCtx.min,
      SETTINGS_BOUNDS.numCtx.max,
    ),
    keepAlive: parseString(migrated.keepAlive, d.keepAlive),
    transport: parseEnum(
      migrated.transport,
      ["auto", "node", "requestUrl"],
      d.transport,
    ),
    excludedFolders: parseStringArray(migrated.excludedFolders, d.excludedFolders),
    excludedTags: parseStringArray(migrated.excludedTags, d.excludedTags),
    qa: {
      multiTurn: parseBoolean(qaRaw.multiTurn, d.qa.multiTurn),
      maxHops: clampInt(
        qaRaw.maxHops,
        d.qa.maxHops,
        SETTINGS_BOUNDS.qaMaxHops.min,
        SETTINGS_BOUNDS.qaMaxHops.max,
      ),
      wallClockSec: clampInt(
        qaRaw.wallClockSec,
        d.qa.wallClockSec,
        SETTINGS_BOUNDS.qaWallClockSec.min,
        SETTINGS_BOUNDS.qaWallClockSec.max,
      ),
    },
    contradiction: {
      onIdle: {
        enabled: parseBoolean(onIdleRaw.enabled, d.contradiction.onIdle.enabled),
        debounceSec: clampInt(
          onIdleRaw.debounceSec,
          d.contradiction.onIdle.debounceSec,
          SETTINGS_BOUNDS.contradictionDebounceSec.min,
        ),
      },
    },
    resurface: {
      enabled: parseBoolean(resurfaceRaw.enabled, d.resurface.enabled),
      staleDays: clampInt(
        resurfaceRaw.staleDays,
        d.resurface.staleDays,
        SETTINGS_BOUNDS.resurfaceStaleDays.min,
        SETTINGS_BOUNDS.resurfaceStaleDays.max,
      ),
      dateField: parseString(resurfaceRaw.dateField, d.resurface.dateField),
    },
    logLevel: parseEnum(
      migrated.logLevel,
      ["debug", "info", "warn", "error"],
      d.logLevel,
    ),
  };

  const checked = settingsSchema.safeParse(parsed);
  if (!checked.success) {
    return { ...cloneSettings(DEFAULT_SETTINGS) };
  }
  return checked.data;
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
