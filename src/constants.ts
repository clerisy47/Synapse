/**
 * Build-time identity and tunables (DESIGN §8.4 / ADR-17).
 * Single source of truth for plugin ID, view types, exclusion key, and provisional numbers.
 * No imports. No Obsidian / Node APIs.
 */

// --- Identity (F-07) ---

export const PLUGIN_ID = "vault-synapse" as const;
export const PLUGIN_NAME = "Vault Synapse" as const;
export const PLUGIN_DESCRIPTION =
  "OpenRouter free-model Q&A (Phase A), then local Ollama (Phase B): Markdown vault search and cited chat — no embeddings, no telemetry." as const;
export const PLUGIN_AUTHOR = "Utsav Acharya" as const;
export const PLUGIN_VERSION = "0.1.0" as const;
export const MIN_APP_VERSION = "1.8.7" as const;
export const IS_DESKTOP_ONLY = true as const;

/** Frontmatter key for note exclusion: `<key>: ignore` (case-insensitive). */
export const EXCLUSION_FRONTMATTER_KEY = PLUGIN_ID;
export const EXCLUSION_FRONTMATTER_VALUE = "ignore" as const;

export const VIEW_TYPE_CHAT = `${PLUGIN_ID}-chat` as const;

/** CSS selector prefix → `.syn-*` (AGENTS.md / DESIGN). */
export const CSS_PREFIX = "syn" as const;

// --- Tunables (DESIGN §8.4) ---

/** Yield interval in scans (ms). Provisional (R3). */
export const SLICE_MS = 10;

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

/** num_predict per prompt kind. Provisional. */
export const NUM_PREDICT = {
  // Router-selected reasoning models share this budget with visible JSON output.
  health: 512,
  select: 100,
  plan: 200,
  answer: 600,
} as const;

/** Minimum Ollama version string (Phase B only). Provisional; finalize at Gate A. */
export const MIN_OLLAMA_VERSION = "0.9.0" as const;

/** Phase A default OpenRouter base URL (no trailing slash required by client). */
export const DEFAULT_OPENROUTER_BASE_URL =
  "https://openrouter.ai/api/v1" as const;

/**
 * Phase A default model — OpenRouter free router (user decision 2026-10-13).
 * Use this router for all live probes; it selects from currently available free models.
 */
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free" as const;

/** Env var name for dev/CI OpenRouter key (never commit the value). */
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY" as const;

/**
 * Content-cache text cap (MB). Provisional; measure with Markdown vaults.
 * Intentionally unset — callers must treat absence as "no cap yet".
 */
export const CACHE_TEXT_CAP_MB: number | null = null;

/** `data.json` schema version (DESIGN §4.6). */
export const STATE_SCHEMA_VERSION = 1 as const;

/** Debounce for StateStore writes to `data.json` (ms). DESIGN §4.3. */
export const STATE_WRITE_DEBOUNCE_MS = 30_000;

/** Provisional bounds for user-editable control contracts; not model-output schemas. */
export const CONTROL_LIMITS = {
  changes: 64,
  markdownChars: 200_000,
  evidenceIds: 64,
  rules: 128,
  masks: 32,
  destinations: 64,
  identifierChars: 64,
  pathChars: 1024,
  literalChars: 1024,
  headingChars: 200,
} as const;

export const DEFAULT_CONTROL_PATHS = { instructions: "Synapse/Instructions.md", security: "Synapse/Security.md", research: "Research.md" } as const;

/** Provisional inbox ledger cap; never silently evict processing history. */
export const RESEARCH_LEDGER_MAX_RECORDS = 1000;

/** Bounded in-memory research generation; no implicit truncation. */
export const PROPOSAL_LIMITS = { targets: 8, inputChars: 48_000, entryChars: 8_000, outputTokens: 4_000 } as const;

/** Recovery text stays in plugin storage; unresolved intents are never evicted. */
export const RECOVERY_LIMITS = {
  records: 20,
  files: CONTROL_LIMITS.changes,
  chars: 4_000_000,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
} as const;

/** Frozen provisional MCP v1 resource bounds. */
export const MCP_LIMITS = {
  bodyBytes: 65_536, headerBytes: 8_192, ioMs: 5_000, workMs: 60_000,
  outputBytes: 65_536, clients: 16, labelPoints: 80, burst: 5,
  perMinute: 20, unauthPerMinute: 60, concurrency: 4,
  questionPoints: 4_000, researchPoints: 32_000, sources: 10, urlChars: 2_048, metaBytes: 4_096,
} as const;

export const COLLABORATION_LIMITS = { receipts: 1000, retentionMs: 30 * 24 * 60 * 60 * 1000, references: 12, excerptPoints: 600, answerPoints: 12000 } as const;
