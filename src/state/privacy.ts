import type { StoragePort } from "../core";
import { defaultPersistedState, type PersistedState } from "./parse";

/** Freeze persistence before erasure so late jobs cannot restore cleared history. */
export function createPrivacyStorage(raw: StoragePort): {
  storage: StoragePort;
  clear(snapshot: PersistedState, stop: () => void): Promise<void>;
} {
  let stopped = false;
  const pending = new Set<Promise<void>>();
  function write(work: () => Promise<void>): Promise<void> {
    if (stopped) return Promise.reject(new Error("Storage stopped"));
    const result = work();
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  }
  return {
    storage: {
      ...raw,
      saveData: (value) => write(() => raw.saveData(value)),
      writeJson: (path, value) => write(() => raw.writeJson(path, value)),
      remove: (path) => write(() => raw.remove(path)),
      removeDir: (path) => write(() => raw.removeDir(path)),
    },
    async clear(snapshot, stop) {
      if (stopped) throw new Error("Storage stopped");
      const clean = defaultPersistedState();
      clean.settings = structuredClone(snapshot.settings);
      clean.settingsUpdatedAt = snapshot.settingsUpdatedAt;
      stopped = true;
      stop();
      for (const key of Object.keys(snapshot)) delete snapshot[key];
      Object.assign(snapshot, structuredClone(clean));
      await Promise.allSettled([...pending]);
      // Explicit owned files only: never touch assets, settings or vault files.
      for (const path of ["recovery.json", "mcp-receipts.json", "mcp-grants.json"]) await raw.remove(path);
      await raw.saveData(clean);
    },
  };
}
