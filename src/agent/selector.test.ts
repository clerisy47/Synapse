/**
 * Selectors + prompts (DESIGN §6.2, M3-T04).
 */

import { describe, expect, it } from "vitest";

import { ScriptedModel } from "../../test/fakes";
import { estimateTokens, type ExcerptId } from "../core";
import {
  buildAnswerPrompt,
  buildPlanPrompt,
  buildSelectPrompt,
  createSelector,
  formatCompactSelectLines,
  QA_NUM_PREDICT,
} from "./index";

const IDS = ["E1", "E2", "E3", "E4", "E5"] as ExcerptId[];

function openSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("createSelector / ModelSelector", () => {
  it("maps scripted qa.select to readIds and enough", async () => {
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.select",
      value: { read: ["E1", "E3"], enough: false },
    });
    const selector = createSelector("model", model);
    const result = await selector.select({
      question: "What is the deadline?",
      candidateIds: IDS.slice(0, 4),
      compactRender: "[E1] A: a\n[E2] B: b\n[E3] C: c\n[E4] D: d",
      maxReads: 4,
      signal: openSignal(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readIds).toEqual(["E1", "E3"]);
    expect(result.value.enough).toBe(false);
    expect(result.value.usage).toBeDefined();
    expect(model.remaining()).toBe(0);
  });

  it("drops unknown IDs and clamps to maxReads", async () => {
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.select",
      value: { read: ["E1", "E99", "E2", "E3"], enough: true },
    });
    const selector = createSelector("model", model);
    const result = await selector.select({
      question: "q",
      candidateIds: ["E1", "E2", "E3"] as ExcerptId[],
      compactRender: "[E1] A: a",
      maxReads: 2,
      signal: openSignal(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readIds).toEqual(["E1", "E2"]);
    expect(result.value.enough).toBe(true);
  });

  it("forwards model errors", async () => {
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.select",
      error: {
        code: "MODEL_HTTP_ERROR",
        message: "boom",
        retryable: true,
      },
    });
    const selector = createSelector("model", model);
    const result = await selector.select({
      question: "q",
      candidateIds: ["E1"] as ExcerptId[],
      compactRender: "[E1] A: a",
      maxReads: 1,
      signal: openSignal(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MODEL_HTTP_ERROR");
  });
});

describe("createSelector / TopKSelector", () => {
  it("returns top-K without consuming the model", async () => {
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.select",
      value: { read: ["E9"], enough: false },
    });
    const selector = createSelector("top-k", model);
    const result = await selector.select({
      question: "q",
      candidateIds: IDS,
      compactRender: "",
      maxReads: 3,
      signal: openSignal(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.readIds).toEqual(["E1", "E2", "E3"]);
    expect(result.value.enough).toBe(true);
    expect(result.value.usage).toBeUndefined();
    expect(model.remaining()).toBe(1);
  });

  it("empty candidates → empty readIds, enough true", async () => {
    const model = new ScriptedModel();
    const selector = createSelector("top-k", model);
    const result = await selector.select({
      question: "q",
      candidateIds: [],
      compactRender: "",
      maxReads: 4,
      signal: openSignal(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ readIds: [], enough: true });
  });

  it("aborted signal returns CANCELLED", async () => {
    const ac = new AbortController();
    ac.abort();
    const selector = createSelector("top-k", new ScriptedModel());
    const result = await selector.select({
      question: "q",
      candidateIds: IDS,
      compactRender: "",
      maxReads: 2,
      signal: ac.signal,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CANCELLED");
  });
});

describe("prompts", () => {
  it("plan prompt caps history at 3 turns and forbids paths", () => {
    const history = [
      { role: "user" as const, text: "t0" },
      { role: "assistant" as const, text: "a0" },
      { role: "user" as const, text: "t1" },
      { role: "assistant" as const, text: "a1" },
      { role: "user" as const, text: "t2" },
      { role: "assistant" as const, text: "a2" },
    ];
    const { instructions, input } = buildPlanPrompt("What changed?", history);
    expect(instructions).toMatch(/ledger IDs|Never name vault paths/i);
    expect(instructions.toLowerCase()).not.toMatch(/emit.*(path|file name)/);
    expect(input).toContain("Question: What changed?");
    expect(input).not.toContain("t0");
    expect(input).not.toContain("a0");
    // Last 3 turns only: a1, t2, a2
    expect(input).toContain("assistant: a1");
    expect(input).toContain("user: t2");
    expect(input).toContain("assistant: a2");
  });

  it("select prompt uses compact ledger lines, not path instructions", () => {
    const lines = "[E1] Note › Intro: hello\n[E2] Other: world";
    const { instructions, input } = buildSelectPrompt("Why?", lines);
    expect(instructions).toMatch(/ledger IDs/i);
    expect(instructions.toLowerCase()).toContain("never name vault paths");
    expect(input).toContain("[E1]");
    expect(input).toContain("[E2]");
    expect(input).toContain("Question: Why?");
  });

  it("answer prompt includes evidence and unknown-ID feedback", () => {
    const evidence = "[E1] Title\nbody text";
    const { instructions, input } = buildAnswerPrompt("Q?", evidence, {
      unknownIds: ["E99", "E0"],
    });
    expect(instructions).toMatch(/ledger IDs/i);
    expect(input).toContain(evidence);
    expect(input).toContain("E99");
    expect(input).toContain("E0");
  });

  it("formatCompactSelectLines trims to token budget", () => {
    const lines = [
      {
        id: "E1" as ExcerptId,
        title: "One",
        heading: "H",
        snippet: "alpha",
      },
      {
        id: "E2" as ExcerptId,
        title: "Two",
        snippet: "beta ".repeat(200),
      },
    ];
    const firstCost = estimateTokens("[E1] One › H: alpha");
    const trimmed = formatCompactSelectLines(lines, firstCost);
    expect(trimmed.included).toEqual(["E1"]);
    expect(trimmed.dropped).toEqual(["E2"]);
    expect(trimmed.text).toBe("[E1] One › H: alpha");
  });

  it("exports local QA_NUM_PREDICT mirrors", () => {
    expect(QA_NUM_PREDICT).toEqual({ plan: 200, select: 100, answer: 600 });
  });
});
