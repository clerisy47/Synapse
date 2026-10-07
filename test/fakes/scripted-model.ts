/**
 * Scripted ModelPort for CI (DESIGN §5.4 / §9.1).
 * Returns canned structured output per PromptKind; no network.
 *
 * ModelPort types live here until `src/llm` owns the production client (M1-T10).
 */

import type { z } from "zod";

import {
  err,
  ok,
  synapseError,
  type Result,
  type SynapseError,
} from "../../src/core";
import type { PromptKind } from "../../src/llm";

export interface ModelUsage {
  promptTokens: number;
  outputTokens: number;
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
  totalMs: number;
}

export interface StructuredResponse<T> {
  value: T;
  usage: ModelUsage;
  attempts: 1 | 2;
}

export interface StructuredRequest<T> {
  kind: PromptKind;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  numPredict: number;
}

export interface ModelPort {
  generate<T>(
    req: StructuredRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<StructuredResponse<T>>>;
}

const ZERO_USAGE: ModelUsage = {
  promptTokens: 0,
  outputTokens: 0,
  loadMs: 0,
  promptEvalMs: 0,
  evalMs: 0,
  totalMs: 0,
};

export type ScriptedStep =
  | { kind?: PromptKind; value: unknown; attempts?: 1 | 2; usage?: ModelUsage }
  | { kind?: PromptKind; error: SynapseError };

export class ScriptedModel implements ModelPort {
  private readonly script: ScriptedStep[] = [];

  enqueue(...steps: ScriptedStep[]): void {
    this.script.push(...steps);
  }

  remaining(): number {
    return this.script.length;
  }

  async generate<T>(
    req: StructuredRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<StructuredResponse<T>>> {
    if (signal.aborted) {
      return err(
        synapseError({
          code: "CANCELLED",
          message: "ScriptedModel: aborted before generate",
        }),
      );
    }

    const idx = this.script.findIndex(
      (s) => s.kind === undefined || s.kind === req.kind,
    );
    if (idx < 0) {
      return err(
        synapseError({
          code: "INTERNAL",
          message: `ScriptedModel: no scripted step for kind ${req.kind}`,
        }),
      );
    }
    const [step] = this.script.splice(idx, 1);

    if (signal.aborted) {
      return err(
        synapseError({
          code: "CANCELLED",
          message: "ScriptedModel: aborted during generate",
        }),
      );
    }

    if ("error" in step) {
      return err(step.error);
    }

    let value: T;
    try {
      value = req.schema.parse(step.value);
    } catch (cause) {
      return err(
        synapseError({
          code: "SCHEMA_INVALID",
          message: "ScriptedModel: scripted value failed schema.parse",
          cause,
        }),
      );
    }

    return ok({
      value,
      usage: step.usage ?? ZERO_USAGE,
      attempts: step.attempts ?? 1,
    });
  }
}
