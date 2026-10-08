/**
 * Q&A run budgets (DESIGN §5.4 RunBudget, §6.2 wall-clock fractions).
 * Provisional numbers until Gate A (M1-T17 deferred).
 */

import { estimateTokens } from "../core";

/** DESIGN §5.4 defaults — keep local (agent must not import constants.ts). */
const DEFAULT_MAX_HOPS = 6;
const DEFAULT_MAX_READS = 4;
const DEFAULT_MAX_MODEL_CALLS = 6;
const DEFAULT_WALL_CLOCK_MS = 45_000;
const FRAC_NO_NEW_SEARCH = 0.55;
const FRAC_FORCE_ANSWER = 0.8;
const FRAC_NO_RETRY = 0.9;
/** Tokens reserved beyond numPredict when sizing the prompt (AC-M2.4). */
const DEFAULT_TOKEN_MARGIN = 64;

export interface RunBudget {
  maxHops: number;
  maxReads: number;
  maxModelCalls: number;
  wallClockMs: number;
  noNewSearchAfter: number;
  forceAnswerAfter: number;
  noRetryAfter: number;
}

export interface CreateRunBudgetOpts {
  maxHops?: number;
  maxReads?: number;
  maxModelCalls?: number;
  wallClockMs?: number;
}

/** Counters the machine tracks; used by follow-up / remaining helpers. */
export interface RunCounters {
  hops: number;
  reads: number;
  modelCalls: number;
  followupsUsed: number;
}

export function createRunBudget(opts: CreateRunBudgetOpts = {}): RunBudget {
  const wallClockMs = opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  return {
    maxHops: opts.maxHops ?? DEFAULT_MAX_HOPS,
    maxReads: opts.maxReads ?? DEFAULT_MAX_READS,
    maxModelCalls: opts.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS,
    wallClockMs,
    noNewSearchAfter: Math.floor(FRAC_NO_NEW_SEARCH * wallClockMs),
    forceAnswerAfter: Math.floor(FRAC_FORCE_ANSWER * wallClockMs),
    noRetryAfter: Math.floor(FRAC_NO_RETRY * wallClockMs),
  };
}

export function remainingHops(budget: RunBudget, hops: number): number {
  return Math.max(0, budget.maxHops - hops);
}

export function remainingReads(budget: RunBudget, reads: number): number {
  return Math.max(0, budget.maxReads - reads);
}

export function remainingModelCalls(
  budget: RunBudget,
  modelCalls: number,
): number {
  return Math.max(0, budget.maxModelCalls - modelCalls);
}

/** True when another SEARCH-state tool hop is allowed. */
export function canSearch(
  budget: RunBudget,
  activeMs: number,
  hops: number,
): boolean {
  return (
    remainingHops(budget, hops) > 0 &&
    activeMs < budget.noNewSearchAfter &&
    activeMs < budget.wallClockMs
  );
}

export function mustForceAnswer(budget: RunBudget, activeMs: number): boolean {
  return activeMs >= budget.forceAnswerAfter;
}

export function canRetryVerify(budget: RunBudget, activeMs: number): boolean {
  return activeMs < budget.noRetryAfter;
}

/**
 * Follow-up SEARCH after an insufficient answer (at most once).
 * Requires hop/model/wall-clock room and must not be past forceAnswerAfter.
 */
export function canFollowUp(
  budget: RunBudget,
  counters: RunCounters,
  activeMs: number,
): boolean {
  return (
    counters.followupsUsed === 0 &&
    remainingHops(budget, counters.hops) > 0 &&
    remainingModelCalls(budget, counters.modelCalls) > 0 &&
    activeMs < budget.wallClockMs &&
    !mustForceAnswer(budget, activeMs)
  );
}

/**
 * Max tokens available for assembled prompt context (AC-M2.4).
 * Callers trim evidence to this cap via estimateTokens / ledger render.
 */
export function maxPromptTokens(
  numCtx: number,
  numPredict: number,
  margin: number = DEFAULT_TOKEN_MARGIN,
): number {
  return Math.max(0, numCtx - numPredict - margin);
}

/** Whether `text` fits within a token budget (conservative estimate). */
export function fitsTokenBudget(text: string, maxTokens: number): boolean {
  return estimateTokens(text) <= maxTokens;
}
