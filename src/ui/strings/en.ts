/**
 * English UI strings (DESIGN §7 / OQ-15). English-only; keyed for later i18n.
 * Never put note text, prompts, or API keys here.
 */

import type { ErrorCode } from "../../core";

export const CHAT = {
  navigationFailed: "Could not open the cited passage.",
  title: "Synapse chat",
  openCommand: "Open Synapse chat",
  openFailed: "Could not open the chat sidebar. Try again.",
  question: "Question",
  placeholder: "Ask a question about your vault",
  submit: "Ask",
  cancel: "Cancel",
  cancelled: "Question cancelled.",
  insufficient: "There is insufficient evidence in your vault to answer this question.",
  unverified: "Unverified",
  located: "Quote located in source",
  trace: "Search trace",
  results: "results",
  milliseconds: "ms",
  indexing: "Index still warming:",
  stages: {
    queued: "Queued", planning: "Planning", searching: "Searching",
    selecting: "Selecting evidence", reading: "Reading", answering: "Answering",
    verifying: "Locating quotes in sources",
  },
  rejections: { duplicate: "Duplicate skipped", invalid_args: "Invalid arguments", budget: "Budget reached" },
} as const;

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
  modelDesc: "Use openrouter/free to route to currently available free models.",
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
  ACCESS_DENIED: "Access is unavailable or changed. Check Security.md and retry.",
  ENDPOINT_BLOCKED: "That endpoint is blocked. Confirm it in settings.",
  CANCELLED: "",
  TOOL_ARGS_INVALID: "A tool call was rejected.",
  TOOL_DUPLICATE_CALL: "A duplicate tool call was skipped.",
  NOT_FOUND: "",
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

export const CONTROLS = {
  statusCommand: "Control file status",
  setupCommand: "Review missing starter files",
  setupHeading: "Starter file proposal (review only)",
  setupPending: "Creation requires the restricted setup adapter planned in R3-T04. You can create these files manually using the exact contents below.",
  noMissing: "No missing control files. Existing files are preserved.",
  failed: "Unable to inspect control files.",
  invalidPaths: "Control paths must be distinct canonical Markdown paths.",
  status: (instructions: string, security: string) => `Instructions: ${instructions}. Security: ${security}.`,
  labels: { instructions: "Instructions file", security: "Security file", research: "Research inbox" },
  description: "Vault-relative Markdown path. Control files and the inbox are excluded from ordinary search.",
} as const;

export const RESEARCH = {
  captureCommand: "Capture research selection",
  captured: "Research selection captured. Proposal generation and review will be available in a later update.",
  duplicate: (outcome: string) => `This research was already captured (status: ${outcome}). The inbox is preserved.`,
  errors: {
    RESEARCH_INVALID_SOURCE: "Open the configured Research.md inbox and select material to capture.",
    RESEARCH_SELECTION_REQUIRED: "Select nonempty research material before capturing.",
    RESEARCH_SELECTION_TOO_LARGE: "Select a smaller research batch and retry.",
    RESEARCH_DIRTY: "Save the research inbox before capturing the selection.",
    RESEARCH_STALE: "Research changed during capture. Save it, select the material again, and retry.",
    RESEARCH_MISSING: "The configured research inbox is unavailable.",
    RESEARCH_LEDGER_BLOCKED: "Research history is unavailable or invalid. Processing is blocked to prevent duplicate application.",
    RESEARCH_LEDGER_CONFLICT: "Research history contains conflicting outcomes. Processing is blocked.",
    RESEARCH_LEDGER_FULL: "Research history is full. Processing history was preserved; no new batch was captured.",
    RESEARCH_STORAGE_FAILED: "Research history could not be saved. Retry the capture.",
  } as Readonly<Record<string, string>>,
  unavailable: "Research capture is unavailable. Retry after reopening the inbox.",
} as const;

export const REVIEW = {
  command: "Review research",
  title: "Review research changes",
  disclosure: "Generating sends selected research, formatting instructions and permitted destination context to your configured OpenRouter model. Review and approval stay local.",
  milestone: "Apply saves only accepted changes after another conflict check. Writes run one at a time; closing cancels remaining writes. Research is preserved. Recovery saves full before/after note text in plugin storage for up to 30 days (unresolved writes retained), subject to a size cap. Sync and backups may copy it.",
  unavailable: "Research review unavailable. Select saved material in the configured research inbox and check instructions and security rules.",
  destinations: "Choose destinations",
  dailyDate: "Daily note date (YYYY-MM-DD)",
  daily: (folder: string, timezone: string) => `Daily note in ${folder} (${timezone})`,
  generate: "Generate proposals",
  before: "Before — complete original Markdown",
  after: "After — complete proposed Markdown",
  accept: "Accept",
  reject: "Reject",
  undecided: "Choose accept or reject",
  approve: "Approve accepted changes",
  apply: "Apply approved changes",
  outcome: { applied: "Applied", unknown: "Outcome unknown; inspect the note before any further action", refused: "Refused; review again", "not-attempted": "Not attempted" },
  cancel: "Close / cancel",
  provenance: (source: string, provenance: string, start: number, end: number) => `Research source: ${source}; provenance: ${provenance}; selected range: ${start}–${end}`,
  operation: { create: "Create Markdown note", update: "Update Markdown note" },
  issues: "Unresolved issues prevent approval",
  evidence: (ids: readonly string[]) => `Evidence: ${ids.join(", ")}`,
  phase: {
    selecting: "Choose configured destinations and an explicit date for daily notes.",
    generating: "Generating proposals through the model queue…",
    review: "Review all content and accept or reject each change before approving the batch.",
    validating: "Checking current research, targets, editor buffers and rules…",
    approved: "Accepted changes approved for this review session. No notes were saved.",
    applying: "Applying approved changes one at a time…",
    finished: "Application finished. Check each result below. A stopped batch may have saved some notes.",
    stale: "This review is stale. Close it and run Review research again to capture current content and rules.",
    error: "Proposal generation failed or was canceled. Close this review and try again; check destinations, date and permissions.",
    canceled: "Review closed. Remaining writes canceled; an operation already committed is preserved.",
  },
} as const;

export const RECOVERY = {
  command: "Review recovery and revert",
  disclosure: "Recovery stores full original and proposed note text in the plugin folder for up to 30 days, with a size cap. Unresolved writes stay retained. Vault sync or backups may copy this data. Clearing recovery loses revert history. Reverts need a fresh review and approval; created notes revert to empty Markdown files without deletion.",
  pending: "A prior application stopped or has an uncertain outcome. Run Review recovery and revert to inspect reconciled results. No writes were retried.",
  empty: "No retained application records.",
  unavailable: "Recovery or revert unavailable. Check current files, editor buffers, policy and storage; uncertain writes are never retried automatically.",
  record: (id: string, outcomes: readonly string[]) => `${id}: ${outcomes.join(", ")}`,
  revert: "Review revert diff",
  close: "Close",
} as const;

export const MCP_SETTINGS = {
  title: "Local MCP collaboration", description: "Opt-in native clients on IPv4 loopback. Changing plugin settings disables the listener; enable it again when ready. Choose scopes locally, then provision a bearer once. Queries use OpenRouter and return permitted masked excerpts with ordinal references. Submission appends unverified research only; local review is required for target-note changes. Local OS processes can steal credentials. Submission deduplication covers 30 days; older retries may append again.",
  disabled: "Listener disabled", failed: "MCP unavailable. Check local grant storage before enabling again.",
  enable: "Enable local listener", disable: "Disable local listener", label: "Client label",
  query: "Allow vault queries", submit: "Allow research submission", pair: "Confirm scopes and pair client",
  once: "Copy this bearer now. It cannot be recovered. Hide it before sharing your screen.", token: "One-time MCP bearer",
  dismiss: "Hide bearer", revoke: "Revoke", noScopes: "No scopes",
} as const;
