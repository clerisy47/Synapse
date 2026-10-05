/**
 * Clock port (DESIGN §5.1). Implementations live in adapters / test fakes.
 */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** Monotonic milliseconds, for durations. */
  mono(): number;
  /** Local calendar date as `YYYY-MM-DD`. */
  todayLocal(): string;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Yield so the UI thread can breathe (MessageChannel / setTimeout 0). */
  yieldNow(): Promise<void>;
}
