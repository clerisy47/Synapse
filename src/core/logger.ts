/**
 * Logger port (DESIGN §5.1). Never log note text, prompts, or API keys.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null>;

export interface Logger {
  debug(event: string, f?: LogFields): void;
  info(event: string, f?: LogFields): void;
  warn(event: string, f?: LogFields): void;
  error(event: string, f?: LogFields): void;
  child(scope: string): Logger;
}
