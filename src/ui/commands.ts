/**
 * Pure command definitions for Obsidian registration (DESIGN §5.7).
 * Handlers are injected — no Obsidian / adapter imports.
 */

import { CHAT } from "./strings/en";

export type CommandId = "open-chat" | "run-health-check" | "cancel-job" | "debug-list-recent" | "capture-research-selection" | "review-research" | "review-recovery";

export type CommandDef = {
  id: CommandId;
  name: string;
  callback: () => void | Promise<void>;
};

export type M1CommandHandlers = {
  runHealthCheck: () => void | Promise<void>;
  cancelJob: () => void;
};

export type M2CommandHandlers = M1CommandHandlers & {
  /** Optional debug: invoke list_recent and surface path-only summary. */
  debugListRecent?: () => void | Promise<void>;
};

/** Stable suffixes Obsidian prefixes with the plugin id. */
export const COMMAND_IDS = {
  openChat: "open-chat",
  runHealthCheck: "run-health-check",
  cancelJob: "cancel-job",
  debugListRecent: "debug-list-recent",
} as const satisfies Record<string, CommandId>;

export const COMMAND_NAMES = {
  openChat: CHAT.openCommand,
  runHealthCheck: "Run model health check",
  cancelJob: "Cancel current job",
  debugListRecent: "Debug: list recent notes",
} as const;

/**
 * Build M1 walking-skeleton commands with injected handlers.
 */
export function createM1Commands(handlers: M1CommandHandlers): CommandDef[] {
  return [
    {
      id: COMMAND_IDS.runHealthCheck,
      name: COMMAND_NAMES.runHealthCheck,
      callback: () => handlers.runHealthCheck(),
    },
    {
      id: COMMAND_IDS.cancelJob,
      name: COMMAND_NAMES.cancelJob,
      callback: () => {
        handlers.cancelJob();
      },
    },
  ];
}

/** M1 commands plus optional M2 debug tool command. */
export function createM2Commands(handlers: M2CommandHandlers): CommandDef[] {
  const cmds = createM1Commands(handlers);
  if (handlers.debugListRecent) {
    const run = handlers.debugListRecent;
    cmds.push({
      id: COMMAND_IDS.debugListRecent,
      name: COMMAND_NAMES.debugListRecent,
      callback: () => run(),
    });
  }
  return cmds;
}

/** Chat command shares its handler with the ribbon icon. */
export function createM3Commands(handlers: M2CommandHandlers & {
  openChat: () => void | Promise<void>;
}): CommandDef[] {
  return [...createM2Commands(handlers), {
    id: COMMAND_IDS.openChat,
    name: COMMAND_NAMES.openChat,
    callback: () => handlers.openChat(),
  }];
}
