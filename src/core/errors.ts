/**
 * Error model (DESIGN §5.3). Developer messages only — never note text or prompts.
 */

/** Key into ui/strings; UI composes user-facing text. */
export type RemediationKey = string;

export type ErrorCode =
  | "OLLAMA_UNREACHABLE"
  | "OLLAMA_TOO_OLD"
  | "MODEL_NOT_FOUND"
  | "FORMAT_IGNORED"
  | "SCHEMA_INVALID"
  | "OUTPUT_TRUNCATED"
  | "CONTEXT_OVERFLOW"
  | "MODEL_TIMEOUT"
  | "MODEL_HTTP_ERROR"
  | "ENDPOINT_BLOCKED"
  | "CANCELLED"
  | "TOOL_ARGS_INVALID"
  | "TOOL_DUPLICATE_CALL"
  | "NOT_FOUND"
  | "PDF_ENCRYPTED"
  | "PDF_CORRUPT"
  | "PDFJS_UNAVAILABLE"
  | "ACTIVE_NOTE_EXCLUDED"
  | "STORAGE_WRITE_FAILED"
  | "INTERNAL";

export interface SynapseError {
  code: ErrorCode;
  retryable: boolean;
  message: string;
  remediation?: RemediationKey;
  detail?: Record<string, string | number | boolean>;
  cause?: unknown;
}

/** Default retry policy per DESIGN §5.3 table. */
const DEFAULT_RETRYABLE: Record<ErrorCode, boolean> = {
  OLLAMA_UNREACHABLE: false,
  OLLAMA_TOO_OLD: false,
  MODEL_NOT_FOUND: false,
  FORMAT_IGNORED: false,
  SCHEMA_INVALID: true,
  OUTPUT_TRUNCATED: true,
  CONTEXT_OVERFLOW: true,
  MODEL_TIMEOUT: false,
  MODEL_HTTP_ERROR: false,
  ENDPOINT_BLOCKED: false,
  CANCELLED: false,
  TOOL_ARGS_INVALID: false,
  TOOL_DUPLICATE_CALL: false,
  NOT_FOUND: false,
  PDF_ENCRYPTED: false,
  PDF_CORRUPT: false,
  PDFJS_UNAVAILABLE: false,
  ACTIVE_NOTE_EXCLUDED: false,
  STORAGE_WRITE_FAILED: false,
  INTERNAL: false,
};

export type SynapseErrorInit = Pick<SynapseError, "code" | "message"> &
  Partial<Omit<SynapseError, "code" | "message">>;

export function synapseError(init: SynapseErrorInit): SynapseError {
  const retryable = init.retryable ?? DEFAULT_RETRYABLE[init.code];
  const out: SynapseError = {
    code: init.code,
    retryable,
    message: init.message,
  };
  if (init.remediation !== undefined) {
    out.remediation = init.remediation;
  }
  if (init.detail !== undefined) {
    out.detail = init.detail;
  }
  if (init.cause !== undefined) {
    out.cause = init.cause;
  }
  return out;
}
