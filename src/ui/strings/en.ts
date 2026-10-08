/**
 * English UI strings (DESIGN §7 / OQ-15). English-only; keyed for later i18n.
 * Never put note text, prompts, or API keys here.
 */

import type { ErrorCode } from "../../core";

/** Status-bar state labels (AC-M1.7). */
export const STATUS = {
  idle: "Vault Synapse: idle",
  running: "Vault Synapse: {label}",
  runningQueued: "Vault Synapse: {label} ({queued} queued)",
  paused: "Vault Synapse: paused",
  error: "Vault Synapse: error",
  /** Corpus warm progress (M2-T10). */
  indexing: "Vault Synapse: indexing {indexed}/{total}",
} as const;

/** Shared notice action (AC-M1.8). */
export const ACTIONS = {
  retry: "Retry",
  acknowledgeEndpoint: "Acknowledge this endpoint",
} as const;

/**
 * Settings tab labels and warnings (AC-M8.2 / DESIGN §4.5 / §8.1).
 * Never put API keys or note text here.
 */
export const SETTINGS = {
  sectionConnection: "Connection",
  sectionTransport: "Transport",
  sectionExclusions: "Exclusions",

  endpoint: "API endpoint",
  endpointDesc: "OpenRouter base URL (Phase A). Other hosts are blocked.",
  apiKey: "OpenRouter API key",
  apiKeyDesc: "Required for Phase A. Never committed; stored only in plugin data.",
  apiKeyMissing: "Add an API key to enable AI features.",
  model: "Model",
  modelDesc: "Prefer a pinned :free model ID for stable structured output.",
  numCtx: "Context window (num_ctx)",
  numCtxDesc: "Tokens of context sent to the model (2048–8192).",
  provider: "Provider",
  providerDesc: "Phase A uses OpenRouter. Local Ollama arrives in Phase B.",
  transport: "Transport mode",
  transportDesc: "auto prefers Node HTTP; requestUrl is degraded (no stream/cancel).",
  transportAuto: "Auto",
  transportNode: "Node HTTP",
  transportRequestUrl: "requestUrl — degraded",
  excludedFolders: "Excluded folders",
  excludedFoldersDesc: "One vault-relative folder path per line. Applied at ingest.",
  excludedTags: "Excluded tags",
  excludedTagsDesc: "One tag per line (without #). Applied at ingest.",
  endpointAckHost: "Acknowledged non-loopback host",
  endpointAckHostDesc:
    "Phase B only: hostname you explicitly allow when not using loopback.",

  egressWarning:
    "Note excerpts used in AI jobs leave this machine and are sent to OpenRouter.",
  nonLoopbackWarning:
    "This endpoint is not loopback. Acknowledge the host below before Synapse will use it.",
  endpointBlocked:
    "This endpoint is blocked by policy. Fix the URL or acknowledge the host.",
  degradedTransport:
    "Degraded mode: requestUrl cannot stream and cannot cancel in-flight model calls.",
} as const;

/**
 * User-facing notice copy keyed by ErrorCode.
 * Developer `SynapseError.message` must never be shown.
 */
export const ERROR_NOTICES: Record<ErrorCode, string> = {
  OLLAMA_UNREACHABLE: "Cannot reach the model endpoint. Check the URL and try again.",
  OLLAMA_TOO_OLD: "The local model runtime is too old. Update it, then retry.",
  MODEL_NOT_FOUND: "The selected model was not found. Pick another model in settings.",
  FORMAT_IGNORED: "This model ignored structured output. Choose a different model.",
  SCHEMA_INVALID: "The model returned an invalid response. You can retry.",
  OUTPUT_TRUNCATED: "The model reply was truncated. You can retry.",
  CONTEXT_OVERFLOW: "The prompt was too large. Try a narrower question.",
  MODEL_TIMEOUT: "The model timed out. You can retry.",
  MODEL_HTTP_ERROR: "The model request failed. You can retry.",
  ENDPOINT_BLOCKED: "That endpoint is blocked. Confirm it in settings.",
  CANCELLED: "",
  TOOL_ARGS_INVALID: "A tool call was rejected.",
  TOOL_DUPLICATE_CALL: "A duplicate tool call was skipped.",
  NOT_FOUND: "",
  PDF_ENCRYPTED: "A PDF is encrypted and cannot be read.",
  PDF_CORRUPT: "A PDF could not be read.",
  PDFJS_UNAVAILABLE: "PDF support is unavailable in this Obsidian build.",
  ACTIVE_NOTE_EXCLUDED: "The active note is excluded from Synapse.",
  STORAGE_WRITE_FAILED: "Could not save plugin state. Will retry later.",
  INTERNAL: "Something went wrong. Check the developer console.",
};

/** Remediation hints keyed by llm remediation strings. */
export const REMEDIATION: Record<string, string> = {
  set_api_key: "Add an OpenRouter API key in settings.",
  auth_failed: "API key was rejected. Check it in settings.",
  rate_limited: "Rate limited. Wait a moment, then retry.",
  model_http_error: "The model HTTP request failed.",
  format_ignored: "This model ignored structured output.",
  schema_invalid: "The model returned invalid structured output.",
  model_timeout: "The model did not respond in time.",
  endpoint_blocked: "Confirm the non-loopback endpoint in settings.",
  model_not_found: "Pull or select a different model.",
  endpoint_unreachable: "Cannot reach the model endpoint.",
};
