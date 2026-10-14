/**
 * Default settings (DESIGN §4.5 / §8.4).
 * Build-time constants → these defaults → persisted data.json.
 */

import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_CONTROL_PATHS,
} from "../constants";
import { validateControlPaths } from "../core";
import type { Settings } from "./settings";

const paths = validateControlPaths(DEFAULT_CONTROL_PATHS);
if (!paths.ok) throw new Error("Invalid built-in control paths");

export const DEFAULT_SETTINGS: Settings = {
  controlPaths: paths.value,
  endpoint: DEFAULT_OPENROUTER_BASE_URL,
  provider: "openrouter",
  apiKey: null,
  endpointAckHost: null,
  model: DEFAULT_OPENROUTER_MODEL,
  numCtx: 4096,
  keepAlive: "5m",
  transport: "auto",
  excludedFolders: [],
  excludedTags: [],
  qa: {
    multiTurn: false,
    maxHops: 6,
    wallClockSec: 45,
  },
  logLevel: "warn",
};
