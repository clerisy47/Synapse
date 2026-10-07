/**
 * In-memory ring-buffer Logger for CI (DESIGN §8.3).
 * Throws if a string field exceeds 80 chars (dev/test dump guard).
 */

import type { LogFields, LogLevel, Logger } from "../../src/core";

export const LOG_FIELD_MAX_CHARS = 80;
export const DEFAULT_RING_CAPACITY = 500;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogEvent = {
  ts: number;
  level: LogLevel;
  scope: string;
  event: string;
  fields?: LogFields;
};

export type RingBufferLoggerOptions = {
  capacity?: number;
  minLevel?: LogLevel;
  scope?: string;
  /** Epoch ms supplier; defaults to `Date.now`. */
  now?: () => number;
  /** Shared ring for `child()` loggers (diagnostics sees all scopes). */
  sharedBuf?: LogEvent[];
};

export class RingBufferLogger implements Logger {
  private readonly capacity: number;
  private readonly minLevel: LogLevel;
  private readonly scope: string;
  private readonly now: () => number;
  private readonly buf: LogEvent[];

  constructor(opts: RingBufferLoggerOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_RING_CAPACITY;
    this.minLevel = opts.minLevel ?? "debug";
    this.scope = opts.scope ?? "";
    this.now = opts.now ?? (() => Date.now());
    this.buf = opts.sharedBuf ?? [];
  }

  debug(event: string, f?: LogFields): void {
    this.write("debug", event, f);
  }

  info(event: string, f?: LogFields): void {
    this.write("info", event, f);
  }

  warn(event: string, f?: LogFields): void {
    this.write("warn", event, f);
  }

  error(event: string, f?: LogFields): void {
    this.write("error", event, f);
  }

  child(scope: string): Logger {
    const childScope = this.scope ? `${this.scope}.${scope}` : scope;
    return new RingBufferLogger({
      capacity: this.capacity,
      minLevel: this.minLevel,
      scope: childScope,
      now: this.now,
      sharedBuf: this.buf,
    });
  }

  /** Snapshot of retained events (oldest → newest). */
  events(): readonly LogEvent[] {
    return [...this.buf];
  }

  clear(): void {
    this.buf.length = 0;
  }

  private write(level: LogLevel, event: string, f?: LogFields): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return;
    }
    const fields = f === undefined ? undefined : sanitizeFields(f);
    const entry: LogEvent = {
      ts: this.now(),
      level,
      scope: this.scope,
      event,
    };
    if (fields !== undefined) {
      entry.fields = fields;
    }
    this.buf.push(entry);
    while (this.buf.length > this.capacity) {
      this.buf.shift();
    }
  }
}

function sanitizeFields(f: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "string" && v.length > LOG_FIELD_MAX_CHARS) {
      throw new Error(
        `RingBufferLogger: string field "${k}" exceeds ${LOG_FIELD_MAX_CHARS} chars (note/prompt dump?)`,
      );
    }
    out[k] = v;
  }
  return out;
}
