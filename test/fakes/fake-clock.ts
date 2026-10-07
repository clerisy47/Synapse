/**
 * Controllable Clock for vitest (DESIGN §5.1 / §9).
 * Wall and mono advance together via `advance`; sleepers wake when due.
 */

import type { Clock } from "../../src/core";

type Sleeper = {
  untilMono: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date `YYYY-MM-DD` from epoch ms (host TZ). */
export function formatTodayLocal(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export class FakeClock implements Clock {
  private wallMs: number;
  private monoMs: number;
  private readonly sleepers: Sleeper[] = [];

  constructor(startMs = 0) {
    this.wallMs = startMs;
    this.monoMs = startMs;
  }

  now(): number {
    return this.wallMs;
  }

  mono(): number {
    return this.monoMs;
  }

  todayLocal(): string {
    return formatTodayLocal(this.wallMs);
  }

  /** Set wall + mono to an absolute epoch and wake due sleepers. */
  set(epochMs: number): void {
    this.wallMs = epochMs;
    this.monoMs = epochMs;
    this.flushSleepers();
  }

  /** Advance both clocks by `ms` and resolve due sleepers. */
  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("FakeClock.advance: ms must be >= 0");
    }
    this.wallMs += ms;
    this.monoMs += ms;
    this.flushSleepers();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    if (signal?.aborted) {
      return Promise.reject(abortError(signal));
    }
    return new Promise<void>((resolve, reject) => {
      const sleeper: Sleeper = {
        untilMono: this.monoMs + ms,
        resolve,
        reject,
      };
      if (signal) {
        const onAbort = (): void => {
          this.removeSleeper(sleeper);
          reject(abortError(signal));
        };
        sleeper.signal = signal;
        sleeper.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.sleepers.push(sleeper);
    });
  }

  yieldNow(): Promise<void> {
    return Promise.resolve();
  }

  private removeSleeper(sleeper: Sleeper): void {
    const i = this.sleepers.indexOf(sleeper);
    if (i >= 0) {
      this.sleepers.splice(i, 1);
    }
    if (sleeper.signal && sleeper.onAbort) {
      sleeper.signal.removeEventListener("abort", sleeper.onAbort);
    }
  }

  private flushSleepers(): void {
    const due = this.sleepers
      .filter((s) => s.untilMono <= this.monoMs)
      .sort((a, b) => a.untilMono - b.untilMono);
    for (const s of due) {
      this.removeSleeper(s);
      s.resolve();
    }
  }
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}
