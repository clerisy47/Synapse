/**
 * Build-time identity and tunables (DESIGN §8.4 / ADR-17).
 * Single source of truth for plugin ID, view types, exclusion key, and provisional numbers.
 * No imports. No Obsidian / Node APIs.
 */

// --- Identity (F-07) ---

export const PLUGIN_ID = "vault-synapse" as const;
export const PLUGIN_NAME = "Vault Synapse" as const;
export const PLUGIN_DESCRIPTION =
  "OpenRouter free-model Q&A (Phase A), then local Ollama (Phase B): contradiction flags and note resurfacing — no embeddings, no telemetry." as const;
export const PLUGIN_AUTHOR = "Utsav Acharya" as const;
export const PLUGIN_VERSION = "0.1.0" as const;
export const MIN_APP_VERSION = "1.5.0" as const;
export const IS_DESKTOP_ONLY = true as const;

/** Frontmatter key for note exclusion: `<key>: ignore` (case-insensitive). */
export const EXCLUSION_FRONTMATTER_KEY = PLUGIN_ID;
export const EXCLUSION_FRONTMATTER_VALUE = "ignore" as const;

export const VIEW_TYPE_CHAT = `${PLUGIN_ID}-chat` as const;
export const VIEW_TYPE_FLAGS = `${PLUGIN_ID}-flags` as const;
export const VIEW_TYPE_RESURFACE = `${PLUGIN_ID}-resurface` as const;

/** CSS selector prefix → `.syn-*` (AGENTS.md / DESIGN). */
export const CSS_PREFIX = "syn" as const;

// --- Tunables (DESIGN §8.4) ---

/** Yield interval in scans (ms). Provisional (R3). */
export const SLICE_MS = 10;

/** PDF page treated as empty below this non-whitespace char count. Provisional [U]. */
export const EMPTY_PAGE_CHARS = 10;

/** mtime clustering window (hours). Decided (D4) / SPEC. */
export const MTIME_WINDOW_H = 48;

/** Fraction of notes in any MTIME_WINDOW_H window that triggers date-field fallback. */
export const MTIME_FRACTION = 0.5;

/** Max claims extracted per contradiction check. SPEC AC-M6.2. */
export const MAX_CLAIMS = 5;

/** Cap on first-pass compare calls per contradiction job. Provisional (§2.6). */
export const MAX_FIRST_PASSES = 6;

/** Skip contradiction if source prose shorter than this. Provisional (F-14). */
export const MIN_CLAIM_CHARS = 200;

/** Resurface candidate pool size. SPEC AC-M7.4. */
export const RESURFACE_POOL = 30;

/** Max relevance compares per resurface run. SPEC AC-M7.4. */
export const COMPARE_CAP = 15;

/** Max resurfaced items shown. SPEC AC-M7.5. */
export const SHOW_CAP = 5;

/** Dismissal group down-weight: ≥N dismissals in window. SPEC / F-21. */
export const DISMISS_GROUP_THRESHOLD = 3;
/** Dismissal lookback window (days). */
export const DISMISS_GROUP_WINDOW_DAYS = 30;
/** Factor applied after threshold. */
export const DISMISS_GROUP_FACTOR = 0.5;
/** How long the down-weight lasts (days). */
export const DISMISS_GROUP_DURATION_DAYS = 60;
/** Floor for multiplied group factors. */
export const DISMISS_GROUP_FLOOR = 0.25;

/** Active-set: top N recently touched notes. Design F-09. */
export const ACTIVE_SET_TOP_N = 20;
/** Active-set touch lookback (days). */
export const ACTIVE_SET_TOUCH_DAYS = 7;

/** Session window for "touched this session" (hours). Design F-15. */
export const SESSION_WINDOW_H = 8;

/** Max quote chars shown in UI. OQ-12. */
export const QUOTE_DISPLAY_CHARS = 300;

/** Excerpt length bounds (chars). Design. */
export const EXCERPT_CHARS_MIN = 200;
export const EXCERPT_CHARS_MAX = 600;

/** Transport: first-byte timeout (ms). Provisional. */
export const TIMEOUT_FIRST_BYTE_MS = 60_000;
/** Transport: idle between stream chunks (ms). Provisional. */
export const TIMEOUT_IDLE_MS = 20_000;
/** Transport: plain GET timeout (ms). Provisional. */
export const TIMEOUT_GET_MS = 5_000;

/** Delay after layout-ready before daily resurface (seconds). Design. */
export const STARTUP_RESURFACE_DELAY_S = 60;

/** num_predict per prompt kind. Provisional. */
export const NUM_PREDICT = {
  health: 16,
  select: 100,
  plan: 200,
  claims: 300,
  compare: 120,
  answer: 600,
} as const;

/** Minimum Ollama version string (Phase B only). Provisional; finalize at Gate A. */
export const MIN_OLLAMA_VERSION = "0.9.0" as const;

/** Phase A default OpenRouter base URL (no trailing slash required by client). */
export const DEFAULT_OPENROUTER_BASE_URL =
  "https://openrouter.ai/api/v1" as const;

/**
 * Phase A default model — pinned `:free` ID.
 * Prefer pinned models over `openrouter/free` for schema-stable JSON [V 2026-10-05].
 */
export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.8-27b:free" as const;

/** Env var name for dev/CI OpenRouter key (never commit the value). */
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY" as const;

/**
 * Content-cache text cap (MB). Open until Gate B (F-26).
 * Intentionally unset — callers must treat absence as "no cap yet".
 */
export const CACHE_TEXT_CAP_MB: number | null = null;
