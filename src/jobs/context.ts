/**
 * JobContext + step memoization (DESIGN §5.4).
 */

import type { Clock } from "../core";

export type JobAbortReason = { kind: "preempted" } | { kind: "cancelled" };

export interface JobProgress {
  stage: string;
  detail?: string;
}

export interface JobContext {
  readonly signal: AbortSignal;
  readonly clock: Clock;
  step<S>(name: string, fn: () => Promise<S>): Promise<S>;
  activeMs(): number;
  progress(p: JobProgress): void;
}

/** AbortSignal.reason / thrown value for job cancel and preempt. */
export class JobAbortError extends Error {
  readonly reason: JobAbortReason;

  constructor(reason: JobAbortReason) {
    super(reason.kind);
    this.name = "JobAbortError";
    this.reason = reason;
  }
}

function isAbortReason(value: unknown): value is JobAbortReason {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return kind === "preempted" || kind === "cancelled";
}

export function abortReasonOf(signal: AbortSignal): JobAbortReason | undefined {
  const r: unknown = signal.reason;
  if (r instanceof JobAbortError) {
    return r.reason;
  }
  return isAbortReason(r) ? r : undefined;
}

/** Mutable context shared across preempt/resume attempts for one job. */
export class JobContextImpl implements JobContext {
  private readonly memo = new Map<string, unknown>();
  private controller = new AbortController();
  private activeAccumMs = 0;
  private activeSegmentStart: number | null = null;
  private lastProgress: JobProgress | undefined;

  constructor(readonly clock: Clock) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  getProgress(): JobProgress | undefined {
    return this.lastProgress;
  }

  /** Start or resume a run attempt (new AbortController after abort). */
  beginAttempt(): void {
    if (this.controller.signal.aborted) {
      this.controller = new AbortController();
    }
    this.resumeActive();
  }

  abort(reason: JobAbortReason): void {
    this.pauseActive();
    if (!this.controller.signal.aborted) {
      this.controller.abort(new JobAbortError(reason));
    }
  }

  pauseActive(): void {
    if (this.activeSegmentStart === null) {
      return;
    }
    this.activeAccumMs += this.clock.mono() - this.activeSegmentStart;
    this.activeSegmentStart = null;
  }

  resumeActive(): void {
    if (this.activeSegmentStart !== null) {
      return;
    }
    this.activeSegmentStart = this.clock.mono();
  }

  activeMs(): number {
    let total = this.activeAccumMs;
    if (this.activeSegmentStart !== null) {
      total += this.clock.mono() - this.activeSegmentStart;
    }
    return total;
  }

  progress(p: JobProgress): void {
    this.lastProgress = p;
  }

  async step<S>(name: string, fn: () => Promise<S>): Promise<S> {
    if (this.memo.has(name)) {
      return this.memo.get(name) as S;
    }
    if (this.signal.aborted) {
      const reason: unknown = this.signal.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    const value = await fn();
    this.memo.set(name, value);
    return value;
  }
}
