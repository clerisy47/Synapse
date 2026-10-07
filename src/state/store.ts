/**
 * StateStore: load / debounce-save / reload-merge (DESIGN §5.4).
 */

import { STATE_WRITE_DEBOUNCE_MS } from "../constants";
import type { Clock, Disposable, StoragePort } from "../core";
import { mergeState } from "./merge";
import {
  defaultPersistedState,
  parsePersisted,
  type PersistedState,
} from "./parse";

export interface StateStore {
  get(): PersistedState;
  /** Mutate in place; schedules a debounced save. Callers bump settingsUpdatedAt when changing settings. */
  update(fn: (s: PersistedState) => void): void;
  flush(): Promise<void>;
  reloadAndMerge(): Promise<void>;
  /** Clears dismissals, touchLog, resurface, and unknown keys; keeps settings (F-31). */
  clearAll(): Promise<void>;
  dispose(): void;
}

/** Schedule a callback; return a cancel function (Disposable). */
export type DebounceScheduler = (
  fn: () => void,
  ms: number,
) => Disposable;

export interface CreateStateStoreOptions {
  storage: StoragePort;
  clock: Clock;
  /** Pre-parsed state; skips loadData when provided. */
  initial?: PersistedState;
  debounceMs?: number;
  /**
   * Debounce scheduler. Defaults to `window` timers (Obsidian popout-safe).
   * Tests inject a no-op or fake scheduler (no DOM `window` in vitest).
   */
  schedule?: DebounceScheduler;
}

export interface LoadStateStoreResult {
  store: StateStore;
  warnings: string[];
}

function cloneState(state: PersistedState): PersistedState {
  const known = new Set([
    "schemaVersion",
    "settings",
    "settingsUpdatedAt",
    "dismissals",
    "touchLog",
    "resurface",
  ]);
  const settings = state.settings;
  const out: PersistedState = {
    schemaVersion: state.schemaVersion,
    settings: {
      ...settings,
      excludedFolders: [...settings.excludedFolders],
      excludedTags: [...settings.excludedTags],
      qa: { ...settings.qa },
      contradiction: {
        onIdle: { ...settings.contradiction.onIdle },
      },
      resurface: { ...settings.resurface },
    },
    settingsUpdatedAt: state.settingsUpdatedAt,
    dismissals: Object.fromEntries(
      Object.entries(state.dismissals).map(([k, v]) => {
        const copy: (typeof state.dismissals)[string] = {
          kind: v.kind,
          at: v.at,
          active: v.active,
        };
        if (v.sourcePath !== undefined) copy.sourcePath = v.sourcePath;
        if (v.otherPath !== undefined) copy.otherPath = v.otherPath;
        if (v.claimHash !== undefined) copy.claimHash = v.claimHash;
        if (v.groups !== undefined) copy.groups = [...v.groups];
        return [k, copy];
      }),
    ),
    touchLog: { ...state.touchLog },
    resurface: { lastRunDay: state.resurface.lastRunDay },
  };
  for (const [key, value] of Object.entries(state)) {
    if (!known.has(key)) out[key] = value;
  }
  return out;
}

function stripToPersisted(state: PersistedState): PersistedState {
  // Persist a deep-enough clone; no note text fields exist by construction.
  return cloneState(state);
}

function clearUnknownKeys(state: PersistedState): void {
  const known = new Set([
    "schemaVersion",
    "settings",
    "settingsUpdatedAt",
    "dismissals",
    "touchLog",
    "resurface",
  ]);
  for (const key of Object.keys(state)) {
    if (!known.has(key)) {
      delete state[key];
    }
  }
}

function defaultWindowSchedule(fn: () => void, ms: number): Disposable {
  const id = window.setTimeout(fn, ms);
  return () => {
    window.clearTimeout(id);
  };
}

/** Create a StateStore from an already-parsed (or default) state. */
export function createStateStore(opts: CreateStateStoreOptions): StateStore {
  const { storage } = opts;
  const debounceMs = opts.debounceMs ?? STATE_WRITE_DEBOUNCE_MS;
  const schedule = opts.schedule ?? defaultWindowSchedule;
  let current = cloneState(opts.initial ?? defaultPersistedState());
  let cancelDebounce: Disposable | null = null;
  let saveChain: Promise<void> = Promise.resolve();
  let disposed = false;

  const external: Disposable = storage.onExternalDataChange(() => {
    void store.reloadAndMerge();
  });

  const scheduleSave = (): void => {
    if (disposed) return;
    if (cancelDebounce !== null) {
      cancelDebounce();
      cancelDebounce = null;
    }
    cancelDebounce = schedule(() => {
      cancelDebounce = null;
      saveChain = saveChain.then(() => persist());
    }, debounceMs);
  };

  const persist = async (): Promise<void> => {
    if (disposed) return;
    await storage.saveData(stripToPersisted(current));
  };

  const store: StateStore = {
    get(): PersistedState {
      return current;
    },

    update(fn: (s: PersistedState) => void): void {
      fn(current);
      scheduleSave();
    },

    async flush(): Promise<void> {
      if (cancelDebounce !== null) {
        cancelDebounce();
        cancelDebounce = null;
      }
      saveChain = saveChain.then(() => persist());
      await saveChain;
    },

    async reloadAndMerge(): Promise<void> {
      const raw = await storage.loadData();
      const { state: disk } = parsePersisted(raw);
      current = mergeState(current, disk);
      // External sync already on disk; no immediate rewrite required.
    },

    async clearAll(): Promise<void> {
      const keptSettings = current.settings;
      const keptAt = current.settingsUpdatedAt;
      const keptVersion = current.schemaVersion;
      clearUnknownKeys(current);
      current.schemaVersion = keptVersion;
      current.settings = keptSettings;
      current.settingsUpdatedAt = keptAt;
      current.dismissals = {};
      current.touchLog = {};
      current.resurface = { lastRunDay: null };
      await store.flush();
    },

    dispose(): void {
      disposed = true;
      if (cancelDebounce !== null) {
        cancelDebounce();
        cancelDebounce = null;
      }
      external();
    },
  };

  // Clock is part of the public factory API for settings/touch stamps at call sites.
  void opts.clock;

  return store;
}

/** Load data.json, parse tolerantly, and build a StateStore. */
export async function loadStateStore(
  opts: Omit<CreateStateStoreOptions, "initial">,
): Promise<LoadStateStoreResult> {
  const raw = await opts.storage.loadData();
  const { state, warnings } = parsePersisted(raw);
  return {
    store: createStateStore({ ...opts, initial: state }),
    warnings,
  };
}
