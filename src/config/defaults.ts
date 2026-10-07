/**
 * Default settings (DESIGN §4.5 / §8.4).
 * Build-time constants → these defaults → persisted data.json.
 */

import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../constants";
import type { Settings } from "./settings";

export const DEFAULT_SETTINGS: Settings = {
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
  contradiction: {
    onIdle: {
      enabled: false,
      debounceSec: 30,
    },
  },
  resurface: {
    enabled: true,
    staleDays: 90,
    dateField: "created",
  },
  logLevel: "warn",
};
