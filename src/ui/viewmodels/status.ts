/**
 * Pure status-bar / notice viewmodel (AC-M1.7, AC-M1.8).
 * Maps JobQueue QueueStatus → display fields; never exposes SynapseError.message.
 */

import type { ErrorCode, SynapseError } from "../../core";
import type { QueueStatus } from "../../jobs";
import { ACTIONS, ERROR_NOTICES, REMEDIATION, STATUS } from "../strings/en";
import { interpolate } from "../strings/t";

/** Codes that surface a Retry action on the notice (DESIGN §5.3 / AC-M1.8). */
const RETRY_CODES: ReadonlySet<ErrorCode> = new Set([
  "SCHEMA_INVALID",
  "OUTPUT_TRUNCATED",
  "MODEL_TIMEOUT",
  "MODEL_HTTP_ERROR",
]);

/** Codes that must not raise a user notice. */
const SILENT_CODES: ReadonlySet<ErrorCode> = new Set(["CANCELLED", "NOT_FOUND"]);

export interface StatusVm {
  model: QueueStatus["model"];
  /** Status-bar text (from strings only). */
  barText: string;
  /** CSS class modifier: idle | running | paused | error. */
  cssModifier: QueueStatus["model"];
  showNotice: boolean;
  showRetry: boolean;
  /** Stable identity for notice edge-dedupe. */
  errorIdentity: string | null;
  /** Notice body, or null when not showing. */
  noticeText: string | null;
  /** Retry button label when showRetry. */
  retryLabel: string | null;
}

function noticeForError(error: SynapseError): string {
  const base = ERROR_NOTICES[error.code] || ERROR_NOTICES.INTERNAL;
  const rem =
    error.remediation !== undefined ? REMEDIATION[error.remediation] : undefined;
  if (rem && rem.length > 0 && rem !== base) {
    return `${base} ${rem}`;
  }
  return base;
}

function barTextFor(status: QueueStatus): string {
  switch (status.model) {
    case "idle":
      return STATUS.idle;
    case "paused":
      return STATUS.paused;
    case "error":
      return STATUS.error;
    case "running": {
      const label = status.running?.label ?? "working";
      if (status.queued > 0) {
        return interpolate(STATUS.runningQueued, {
          label,
          queued: status.queued,
        });
      }
      return interpolate(STATUS.running, { label });
    }
    default: {
      const _exhaustive: never = status.model;
      return _exhaustive;
    }
  }
}

export function toStatusVm(status: QueueStatus): StatusVm {
  const barText = barTextFor(status);
  const cssModifier = status.model;

  if (status.model !== "error" || status.lastError === undefined) {
    return {
      model: status.model,
      barText,
      cssModifier,
      showNotice: false,
      showRetry: false,
      errorIdentity: null,
      noticeText: null,
      retryLabel: null,
    };
  }

  const error = status.lastError;
  if (SILENT_CODES.has(error.code)) {
    return {
      model: status.model,
      barText,
      cssModifier,
      showNotice: false,
      showRetry: false,
      errorIdentity: null,
      noticeText: null,
      retryLabel: null,
    };
  }

  const showRetry = RETRY_CODES.has(error.code);
  const rem = error.remediation ?? "";
  const errorIdentity = `${error.code}:${rem}`;

  return {
    model: status.model,
    barText,
    cssModifier,
    showNotice: true,
    showRetry,
    errorIdentity,
    noticeText: noticeForError(error),
    retryLabel: showRetry ? ACTIONS.retry : null,
  };
}
