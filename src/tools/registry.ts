/**
 * ToolRegistry facade (DESIGN §5.4) — validate, dispatch, canonical keys.
 */

import { synapseError, type SynapseError } from "../core";
import { isToolName, parseToolArgs, type ToolArgsByName, type ToolName } from "./args";
import { canonicalKey as buildCanonicalKey } from "./canonical";

export type ToolOutcome<T> =
  | { ok: true; data: T; truncated: boolean }
  | { ok: false; error: SynapseError };

export type ToolInvokeContext = { signal: AbortSignal };

export type ToolHandler<N extends ToolName = ToolName> = (
  args: ToolArgsByName[N],
  ctx: ToolInvokeContext,
) => Promise<ToolOutcome<unknown>>;

export type ToolHandlers = {
  [N in ToolName]?: ToolHandler<N>;
};

export interface ToolRegistry {
  invoke(
    name: ToolName,
    rawArgs: unknown,
    ctx: ToolInvokeContext,
  ): Promise<ToolOutcome<unknown>>;
  /** Stable key after normalize; invalid args → TOOL_ARGS_INVALID outcome shape via Result in canonical. */
  canonicalKey(name: ToolName, rawArgs: unknown): string | null;
}

export interface CreateToolRegistryOptions {
  handlers?: ToolHandlers;
}

export function createToolRegistry(
  options: CreateToolRegistryOptions = {},
): ToolRegistry {
  const handlers = options.handlers ?? {};

  return {
    async invoke(name, rawArgs, ctx) {
      if (!isToolName(name)) {
        return {
          ok: false,
          error: synapseError({
            code: "TOOL_ARGS_INVALID",
            message: "unknown tool",
            remediation: "TOOL_ARGS_INVALID",
          }),
        };
      }
      const parsed = parseToolArgs(name, rawArgs);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const handler = handlers[name] as ToolHandler | undefined;
      if (handler === undefined) {
        return {
          ok: false,
          error: synapseError({
            code: "INTERNAL",
            message: "tool handler not registered",
            detail: { tool: name },
          }),
        };
      }
      return handler(parsed.value, ctx);
    },

    canonicalKey(name, rawArgs) {
      const key = buildCanonicalKey(name, rawArgs);
      return key.ok ? key.value : null;
    },
  };
}
