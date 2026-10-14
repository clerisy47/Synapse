import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../config";
import {
  asVaultPath,
  stableStringify,
  type Clock,
  type Disposable,
  type StoragePort,
} from "../core";
import {
  createStateStore,
  defaultPersistedState,
  loadStateStore,
  mergeState,
  parsePersisted,
  type PersistedState,
} from "./index";

function baseState(partial: Partial<PersistedState> = {}): PersistedState {
  return {
    ...defaultPersistedState(),
    ...partial,
    settings: partial.settings
      ? { ...DEFAULT_SETTINGS, ...partial.settings }
      : defaultPersistedState().settings,
    touchLog: partial.touchLog ?? {},
  };
}

function memoryStorage(initial: unknown = null): StoragePort & {
  data: unknown;
  externalCbs: Array<() => void>;
} {
  const files = new Map<string, unknown>();
  const api = {
    data: initial,
    externalCbs: [] as Array<() => void>,
    async readJson(rel: string): Promise<unknown> {
      return files.has(rel) ? files.get(rel)! : null;
    },
    async writeJson(rel: string, v: unknown): Promise<void> {
      files.set(rel, v);
    },
    async remove(rel: string): Promise<void> {
      files.delete(rel);
    },
    async list(): Promise<string[]> {
      return [...files.keys()];
    },
    async removeDir(): Promise<void> {
      files.clear();
    },
    async loadData(): Promise<unknown> {
      return api.data;
    },
    async saveData(v: unknown): Promise<void> {
      api.data = v;
    },
    onExternalDataChange(cb: () => void): Disposable {
      api.externalCbs.push(cb);
      return () => {
        api.externalCbs = api.externalCbs.filter((c) => c !== cb);
      };
    },
  };
  return api;
}

function fakeClock(now = 1_700_000_000_000): Clock {
  return {
    now: () => now,
    mono: () => now,
    todayLocal: () => "2026-10-07",
    sleep: async () => undefined,
    yieldNow: async () => undefined,
  };
}

/** No-op debounce: flush() performs the actual save in tests. */
function testSchedule(_fn: () => void, _ms: number): () => void {
  return () => undefined;
}

describe("parsePersisted", () => {
  it("returns defaults for null/undefined/non-object", () => {
    for (const raw of [null, undefined, 42, "x", []]) {
      const { state, warnings } = parsePersisted(raw);
      expect(state.settings.model).toBe(DEFAULT_SETTINGS.model);
      expect(state.touchLog).toEqual({});
      if (raw !== null && raw !== undefined) {
        expect(warnings.length).toBeGreaterThan(0);
      }
    }
  });

  it("never throws on hostile blobs", () => {
    expect(() =>
      parsePersisted({
        schemaVersion: "nope",
        settings: "bad",
        settingsUpdatedAt: {},
        dismissals: { a: null, b: { kind: "flag" } },
        touchLog: { p: "late" },
        resurface: 3,
        weird: { kept: true },
      }),
    ).not.toThrow();
  });

  it("preserves unknown top-level keys", () => {
    const { state } = parsePersisted({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      settingsUpdatedAt: 10,
      "x-from-a-newer-version": { kept: true },
    });
    expect(state["x-from-a-newer-version"]).toEqual({ kept: true });
  });

  it("drops retired state and settings while retaining valid activity and future keys", () => {
    const raw = { dismissals: { obsolete: { kind: "flag", at: 1, active: true } },
      resurface: { lastRunDay: "2026-10-02" }, settings: { ...DEFAULT_SETTINGS, contradiction: { onIdle: { enabled: true } }, resurface: { enabled: true } },
      touchLog: { "Notes/A.md": 200, bad: "x" }, future: { retained: true } };
    const original = JSON.stringify(raw);
    const { state, warnings } = parsePersisted(raw);
    expect(state).not.toHaveProperty("dismissals");
    expect(state).not.toHaveProperty("resurface");
    expect(state.settings).toEqual(DEFAULT_SETTINGS);
    expect(state.touchLog).toEqual({ "Notes/A.md": 200 });
    expect(state.future).toEqual({ retained: true });
    expect(warnings).toEqual(["touchLog[bad] invalid; skipped"]);
    expect(JSON.stringify(raw)).toBe(original);
  });

  it("keeps newer schemaVersion without downgrade", () => {
    const { state } = parsePersisted({ schemaVersion: 9 });
    expect(state.schemaVersion).toBe(9);
  });
});

describe("mergeState", () => {
  it("LWW settings on settingsUpdatedAt", () => {
    const a = baseState({
      settingsUpdatedAt: 100,
      settings: { ...DEFAULT_SETTINGS, model: "a-model" },
    });
    const b = baseState({
      settingsUpdatedAt: 200,
      settings: { ...DEFAULT_SETTINGS, model: "b-model" },
    });
    expect(mergeState(a, b).settings.model).toBe("b-model");
    expect(mergeState(b, a).settings.model).toBe("b-model");
  });

  it("does not resurrect retired keys during sync merge", () => {
    const a = baseState({ dismissals: { old: true }, resurface: { lastRunDay: "2026-01-01" } });
    const b = baseState({ settingsUpdatedAt: 2, resurface: { lastRunDay: "2026-10-02" } });
    for (const merged of [mergeState(a, b), mergeState(b, a)]) {
      expect(merged).not.toHaveProperty("dismissals");
      expect(merged).not.toHaveProperty("resurface");
    }
  });

  it("touchLog takes max per path", () => {
    const p = asVaultPath("Notes/A.md");
    const a = baseState({ touchLog: { [p]: 10 } });
    const b = baseState({ touchLog: { [p]: 30 } });
    expect(mergeState(a, b).touchLog[p]).toBe(30);
  });

  it("clones settings and activity without sharing mutable maps", () => {
    const a = baseState({ touchLog: { [asVaultPath("A.md")]: 1 } });
    const merged = mergeState(a, baseState());
    merged.settings.qa.maxHops = 9;
    merged.settings.excludedFolders.push("Private");
    merged.touchLog[asVaultPath("A.md")] = 20;
    expect(a.settings.qa.maxHops).toBe(DEFAULT_SETTINGS.qa.maxHops);
    expect(a.settings.excludedFolders).toEqual([]);
    expect(a.touchLog[asVaultPath("A.md")]).toBe(1);
  });

  it("unknown keys LWW on settingsUpdatedAt", () => {
    const a = baseState({ settingsUpdatedAt: 1 });
    a.ext = "old";
    const b = baseState({ settingsUpdatedAt: 2 });
    b.ext = "new";
    expect(mergeState(a, b).ext).toBe("new");
  });

  it("is commutative, associative, and idempotent (property)", () => {
    const fixtures = randomStates(40);
    for (let i = 0; i < fixtures.length; i++) {
      const a = fixtures[i];
      const b = fixtures[(i + 1) % fixtures.length];
      const c = fixtures[(i + 2) % fixtures.length];
      if (a === undefined || b === undefined || c === undefined) continue;

      expect(stableStringify(mergeState(a, b))).toBe(
        stableStringify(mergeState(b, a)),
      );
      expect(stableStringify(mergeState(mergeState(a, b), c))).toBe(
        stableStringify(mergeState(a, mergeState(b, c))),
      );
      expect(stableStringify(mergeState(a, a))).toBe(stableStringify(a));
    }
  });
});

describe("StateStore", () => {
  it("loadStateStore parses disk and flush persists without note text fields", async () => {
    const storage = memoryStorage({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      settingsUpdatedAt: 5,
      dismissals: {
        "note:Archive/Old.md": {
          kind: "resurface",
          at: 9,
          active: true,
          groups: ["folder:Archive"],
        },
      },
      touchLog: { "Archive/Old.md": 9 },
      resurface: { lastRunDay: "2026-10-01" },
      noteBody: "should not be a known field but may be preserved if unknown",
    });
    const { store, warnings } = await loadStateStore({
      storage,
      clock: fakeClock(),
      schedule: testSchedule,
    });
    expect(warnings).toEqual([]);
    store.update((s) => {
      s.touchLog[asVaultPath("Notes/B.md")] = 42;
    });
    await store.flush();
    const saved = storage.data as Record<string, unknown>;
    expect(saved.touchLog).toMatchObject({ "Notes/B.md": 42 });
    expect(saved).not.toHaveProperty("dismissals");
    expect(saved).not.toHaveProperty("resurface");
    // No claim/excerpt/body keys in known shape
    const json = JSON.stringify(saved);
    expect(json).not.toMatch(/excerpt|claimText|noteText|"body"/i);
    expect(saved.noteBody).toBe(
      "should not be a known field but may be preserved if unknown",
    );
    store.dispose();
  });

  it("debounces save until flush", async () => {
    const storage = memoryStorage(null);
    const saveSpy = vi.spyOn(storage, "saveData");
    const store = createStateStore({
      storage,
      clock: fakeClock(),
      debounceMs: 60_000,
      schedule: testSchedule,
    });
    store.update((s) => {
      s.touchLog[asVaultPath("Note.md")] = 7;
    });
    expect(saveSpy).not.toHaveBeenCalled();
    await store.flush();
    expect(saveSpy).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("reloadAndMerge merges external disk state", async () => {
    const storage = memoryStorage({
      schemaVersion: 1,
      settings: DEFAULT_SETTINGS,
      settingsUpdatedAt: 1,
      dismissals: {},
      touchLog: {},
      resurface: { lastRunDay: null },
    });
    const store = createStateStore({
      storage,
      clock: fakeClock(),
      schedule: testSchedule,
      initial: baseState({
        settingsUpdatedAt: 1,
        touchLog: { [asVaultPath("A.md")]: 10 },
      }),
    });
    storage.data = {
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, model: "from-disk" },
      settingsUpdatedAt: 99,
      dismissals: {},
      touchLog: { "B.md": 20 },
      resurface: { lastRunDay: "2026-10-03" },
    };
    await store.reloadAndMerge();
    expect(store.get().settings.model).toBe("from-disk");
    expect(store.get().touchLog[asVaultPath("A.md")]).toBe(10);
    expect(store.get().touchLog[asVaultPath("B.md")]).toBe(20);
    expect(store.get()).not.toHaveProperty("resurface");
    store.dispose();
  });

  it("clearAll keeps settings and flushes", async () => {
    const storage = memoryStorage(null);
    const initial = baseState({
      settingsUpdatedAt: 50,
      settings: { ...DEFAULT_SETTINGS, model: "keep-me" },
      dismissals: {
        "note:x": { kind: "resurface", at: 1, active: true },
      },
      touchLog: { [asVaultPath("x.md")]: 1 },
      resurface: { lastRunDay: "2026-01-01" },
    });
    initial.extra = true;
    const store = createStateStore({
      storage,
      clock: fakeClock(),
      schedule: testSchedule,
      initial,
    });
    await store.clearAll();
    const s = store.get();
    expect(s.settings.model).toBe("keep-me");
    expect(s.settingsUpdatedAt).toBe(50);
    expect(s).not.toHaveProperty("dismissals");
    expect(s.touchLog).toEqual({});
    expect(s).not.toHaveProperty("resurface");
    expect(s.extra).toBeUndefined();
    const saved = storage.data as PersistedState;
    expect(saved.settings.model).toBe("keep-me");
    expect(saved).not.toHaveProperty("dismissals");
    store.dispose();
  });
});

function randomStates(n: number): PersistedState[] {
  const out: PersistedState[] = [];
  for (let i = 0; i < n; i++) {
    const stamp = (i * 17) % 50;
    const path = asVaultPath(`Notes/n${i % 7}.md`);
    const state = baseState({
      schemaVersion: 1 + (i % 2),
      settingsUpdatedAt: stamp,
      settings: {
        ...DEFAULT_SETTINGS,
        model: i % 2 === 0 ? "model-a" : "model-b",
        numCtx: 2048 + (i % 3) * 1024,
      },
      touchLog: { [path]: 1000 + i },
    });
    if (i % 3 === 0) state[`ext-${i % 2}`] = { v: i };
    out.push(state);
  }
  return out;
}
