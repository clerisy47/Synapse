/**
 * Evidence selectors for Q&A SELECT (DESIGN §6.2 / Gate A).
 * ModelSelector is default; TopKSelector flips without API break.
 */

import {
  err,
  ok,
  synapseError,
  type ExcerptId,
  type Result,
} from "../core";
import {
  selectOutputSchema,
  type ModelPort,
  type ModelUsage,
  type SelectOutput,
} from "../llm";
import { buildSelectPrompt, QA_NUM_PREDICT } from "./prompts";

export type SelectorStrategy = "model" | "top-k";

export type SelectInput = {
  question: string;
  /** Ordered by search score (best first). */
  candidateIds: ExcerptId[];
  /** Token-trimmed compact lines for the select prompt. */
  compactRender: string;
  maxReads: number;
  signal: AbortSignal;
};

export type SelectResult = {
  readIds: ExcerptId[];
  enough: boolean;
  usage?: ModelUsage;
};

export interface EvidenceSelector {
  select(input: SelectInput): Promise<Result<SelectResult>>;
}

export type CreateSelectorOpts = {
  numPredict?: number;
};

/**
 * Gate A switch: same EvidenceSelector surface for model vs top-k.
 */
export function createSelector(
  strategy: SelectorStrategy,
  model: ModelPort,
  opts: CreateSelectorOpts = {},
): EvidenceSelector {
  if (strategy === "top-k") {
    return new TopKSelector();
  }
  return new ModelSelector(model, opts);
}

/**
 * Default: one qa.select model call; maps schema `read` → readIds.
 */
export class ModelSelector implements EvidenceSelector {
  private readonly model: ModelPort;
  private readonly numPredict: number;

  constructor(model: ModelPort, opts: CreateSelectorOpts = {}) {
    this.model = model;
    this.numPredict = opts.numPredict ?? QA_NUM_PREDICT.select;
  }

  async select(input: SelectInput): Promise<Result<SelectResult>> {
    const prompt = buildSelectPrompt(input.question, input.compactRender);
    const generated = await this.model.generate<SelectOutput>(
      {
        kind: "qa.select",
        instructions: prompt.instructions,
        input: prompt.input,
        schema: selectOutputSchema,
        numPredict: this.numPredict,
      },
      input.signal,
    );
    if (!generated.ok) {
      return err(generated.error);
    }

    const allowed = new Set<string>(input.candidateIds);
    const readIds: ExcerptId[] = [];
    for (const raw of generated.value.value.read) {
      if (!allowed.has(raw)) {
        continue;
      }
      const id = raw as ExcerptId;
      if (readIds.includes(id)) {
        continue;
      }
      if (readIds.length >= input.maxReads) {
        break;
      }
      readIds.push(id);
    }

    return ok({
      readIds,
      enough: generated.value.value.enough,
      usage: generated.value.usage,
    });
  }
}

/**
 * Deterministic top-K: no model call; enough=true skips READ (two-call path).
 */
export class TopKSelector implements EvidenceSelector {
  async select(input: SelectInput): Promise<Result<SelectResult>> {
    if (input.signal.aborted) {
      return err(
        synapseError({
          code: "CANCELLED",
          message: "TopKSelector: aborted before select",
        }),
      );
    }
    const n = Math.min(input.maxReads, input.candidateIds.length);
    const readIds = input.candidateIds.slice(0, n);
    return ok({ readIds, enough: true });
  }
}
