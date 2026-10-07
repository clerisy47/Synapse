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
} as const;

/** Shared notice action (AC-M1.8). */
export const ACTIONS = {
  retry: "Retry",
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
