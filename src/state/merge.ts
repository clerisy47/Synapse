/**
 * Pure mergeState for sync-tolerant data.json (DESIGN §4.3).
 * Timestamp ties break by stableStringify so merge stays commutative.
 */

import type { Settings } from "../config";
import { stableStringify, type VaultPath } from "../core";
import type { DismissalRecord, PersistedState } from "./parse";

const KNOWN_KEYS = new Set([
  "schemaVersion",
  "settings",
  "settingsUpdatedAt",
  "dismissals",
  "touchLog",
  "resurface",
]);

function cloneDismissal(record: DismissalRecord): DismissalRecord {
  const out: DismissalRecord = {
    kind: record.kind,
    at: record.at,
    active: record.active,
  };
  if (record.sourcePath !== undefined) out.sourcePath = record.sourcePath;
  if (record.otherPath !== undefined) out.otherPath = record.otherPath;
  if (record.claimHash !== undefined) out.claimHash = record.claimHash;
  if (record.groups !== undefined) out.groups = [...record.groups];
  return out;
}

function pickByStamp<T>(
  aVal: T,
  aStamp: number,
  bVal: T,
  bStamp: number,
): T {
  if (aStamp > bStamp) return aVal;
  if (bStamp > aStamp) return bVal;
  // Tie: deterministic total order on serialized value.
  return stableStringify(aVal) >= stableStringify(bVal) ? aVal : bVal;
}

function mergeDismissals(
  a: Record<string, DismissalRecord>,
  b: Record<string, DismissalRecord>,
): Record<string, DismissalRecord> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, DismissalRecord> = {};
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === undefined && right !== undefined) {
      out[key] = cloneDismissal(right);
    } else if (right === undefined && left !== undefined) {
      out[key] = cloneDismissal(left);
    } else if (left !== undefined && right !== undefined) {
      out[key] = cloneDismissal(
        pickByStamp(left, left.at, right, right.at),
      );
    }
  }
  return out;
}

function mergeTouchLog(
  a: Record<VaultPath, number>,
  b: Record<VaultPath, number>,
): Record<VaultPath, number> {
  const keys = new Set([
    ...(Object.keys(a) as VaultPath[]),
    ...(Object.keys(b) as VaultPath[]),
  ]);
  const out: Record<VaultPath, number> = {};
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === undefined) {
      out[key] = right!;
    } else if (right === undefined) {
      out[key] = left;
    } else {
      out[key] = Math.max(left, right);
    }
  }
  return out;
}

function mergeLastRunDay(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

function unknownKeys(state: PersistedState): string[] {
  return Object.keys(state).filter((k) => !KNOWN_KEYS.has(k));
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

/**
 * Merge two persisted states. Commutative / associative / idempotent
 * (timestamp ties break via stableStringify).
 */
export function mergeState(a: PersistedState, b: PersistedState): PersistedState {
  const settings = cloneSettings(
    pickByStamp(
      a.settings,
      a.settingsUpdatedAt,
      b.settings,
      b.settingsUpdatedAt,
    ),
  );
  const settingsUpdatedAt = Math.max(a.settingsUpdatedAt, b.settingsUpdatedAt);

  const out: PersistedState = {
    schemaVersion: Math.max(a.schemaVersion, b.schemaVersion),
    settings,
    settingsUpdatedAt,
    dismissals: mergeDismissals(a.dismissals, b.dismissals),
    touchLog: mergeTouchLog(a.touchLog, b.touchLog),
    resurface: {
      lastRunDay: mergeLastRunDay(a.resurface.lastRunDay, b.resurface.lastRunDay),
    },
  };

  const keys = new Set([...unknownKeys(a), ...unknownKeys(b)]);
  for (const key of keys) {
    const inA = Object.prototype.hasOwnProperty.call(a, key);
    const inB = Object.prototype.hasOwnProperty.call(b, key);
    if (inA && inB) {
      out[key] = pickByStamp(
        a[key],
        a.settingsUpdatedAt,
        b[key],
        b.settingsUpdatedAt,
      );
    } else if (inB) {
      out[key] = b[key];
    } else {
      out[key] = a[key];
    }
  }

  return out;
}
