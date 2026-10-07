/**
 * In-memory ConfigStore (DESIGN §8.4).
 * Observable settings; persistence is wired later via state (M1-T07).
 */

import { createObservable, type MutableObservable } from "../core";
import { DEFAULT_SETTINGS } from "./defaults";
import { parseSettings, type Settings } from "./settings";

export type ConfigStore = MutableObservable<Settings>;

/** Create a ConfigStore from optional unknown persisted settings. */
export function createConfigStore(raw?: unknown): ConfigStore {
  return createObservable(parseSettings(raw ?? DEFAULT_SETTINGS));
}
