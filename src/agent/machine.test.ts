/**
 * Agent state machine + budgets (DESIGN §6.2, AC-M2.3–2.6).
 */

import { describe, expect, it } from "vitest";

import { estimateTokens } from "../core";
import {
  canSearch,
  createRunBudget,
  fitsTokenBudget,
  initialState,
  isRejected,
  maxPromptTokens,
  mustForceAnswer,
  next,
  type AgentEvent,
  type AgentState,
  type RunBudget,
} from "./index";

function apply(
  state: AgentState,
  event: AgentEvent,
  budget: RunBudget,
  activeMs = 0,
): AgentState {
  const r = next(state, event, budget, activeMs);
  if (isRejected(r)) {
    throw new Error(`unexpected reject: ${r.rejected}`);
  }
  return r;
}

function happyPathToDone(budget: RunBudget = createRunBudget()): AgentState {
  let s = initialState();
  s = apply(s, { type: "planAccepted" }, budget);
  s = apply(s, { type: "toolHop" }, budget);
  s = apply(s, { type: "searchDone" }, budget);
  s = apply(s, { type: "select", readIds: ["E1"], enough: false }, budget);
  s = apply(s, { type: "readsDone" }, budget);
  s = apply(s, { type: "answer", status: "answered" }, budget);
  s = apply(s, { type: "verify", unknownIds: [] }, budget);
  return s;
}

describe("createRunBudget", () => {
  it("derives wall-clock fractions from defaults", () => {
    const b = createRunBudget();
    expect(b.maxHops).toBe(6);
    expect(b.maxReads).toBe(4);
    expect(b.maxModelCalls).toBe(6);
    expect(b.wallClockMs).toBe(45_000);
    expect(b.noNewSearchAfter).toBe(Math.floor(0.55 * 45_000));
    expect(b.forceAnswerAfter).toBe(Math.floor(0.8 * 45_000));
    expect(b.noRetryAfter).toBe(Math.floor(0.9 * 45_000));
  });

  it("scales fractions with custom wallClockMs", () => {
    const b = createRunBudget({ wallClockMs: 10_000 });
    expect(b.forceAnswerAfter).toBe(8_000);
    expect(b.noNewSearchAfter).toBe(5_500);
    expect(b.noRetryAfter).toBe(9_000);
  });
});

describe("token budget (AC-M2.4)", () => {
  it("caps prompt tokens at numCtx − numPredict − margin", () => {
    expect(maxPromptTokens(4096, 600, 64)).toBe(4096 - 600 - 64);
    expect(maxPromptTokens(100, 200, 0)).toBe(0);
  });

  it("assembled context never exceeds the configured cap when trimmed", () => {
    const cap = maxPromptTokens(4096, 600);
    const chunks = ["alpha ".repeat(200), "beta ".repeat(200), "gamma ".repeat(200)];
    let assembled = "";
    for (const c of chunks) {
      const nextText = assembled + c;
      if (estimateTokens(nextText) <= cap) {
        assembled = nextText;
      }
    }
    expect(fitsTokenBudget(assembled, cap)).toBe(true);
    expect(estimateTokens(assembled)).toBeLessThanOrEqual(cap);
  });
});

describe("next — happy path", () => {
  it("PLAN → SEARCH → SELECT → READ → ANSWER → VERIFY → DONE", () => {
    const s = happyPathToDone();
    expect(s.phase).toBe("DONE");
    expect(s.hops).toBe(1);
    expect(s.reads).toBe(1);
    expect(s.modelCalls).toBe(3); // plan + select + answer
  });

  it("SELECT with empty readIds skips READ", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    expect(s.phase).toBe("ANSWER");
    expect(s.pendingReads).toBe(0);
  });

  it("planEmpty → INSUFFICIENT", () => {
    const budget = createRunBudget();
    const s = apply(initialState(), { type: "planEmpty" }, budget);
    expect(s.phase).toBe("INSUFFICIENT");
  });
});

describe("next — hop cap (AC-M2.3)", () => {
  it("never-satisfied query hits hop cap → insufficient", () => {
    const budget = createRunBudget({ maxHops: 6 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    for (let i = 0; i < 5; i++) {
      s = apply(s, { type: "toolHop" }, budget);
      expect(s.phase).toBe("SEARCH");
      expect(s.hops).toBe(i + 1);
    }
    s = apply(s, { type: "toolHop" }, budget);
    expect(s.hops).toBe(6);
    expect(s.phase).toBe("INSUFFICIENT");
  });
});

describe("next — duplicate hops (AC-M2.5)", () => {
  it("duplicate and invalid tool hops count toward the cap", () => {
    const budget = createRunBudget({ maxHops: 3 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "toolHop", rejected: "duplicate" }, budget);
    expect(s.hops).toBe(1);
    expect(s.lastHopRejected).toBe("duplicate");
    s = apply(s, { type: "toolHop", rejected: "invalid_args" }, budget);
    expect(s.hops).toBe(2);
    s = apply(s, { type: "toolHop", rejected: "budget" }, budget);
    expect(s.hops).toBe(3);
    expect(s.phase).toBe("INSUFFICIENT");
  });
});

describe("next — follow-up and budgets", () => {
  it("allows one follow-up SEARCH then second insufficient → INSUFFICIENT", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    s = apply(
      s,
      {
        type: "answer",
        status: "insufficient",
        followup: { terms: ["retry"], phrases: [] },
      },
      budget,
      1_000,
    );
    expect(s.phase).toBe("SEARCH");
    expect(s.followupsUsed).toBe(1);

    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    s = apply(
      s,
      {
        type: "answer",
        status: "insufficient",
        followup: { terms: ["again"], phrases: [] },
      },
      budget,
      1_000,
    );
    expect(s.phase).toBe("INSUFFICIENT");
    expect(s.followupsUsed).toBe(1);
  });

  it("forceAnswer moves SEARCH|SELECT|READ → ANSWER after threshold", () => {
    const budget = createRunBudget({ wallClockMs: 10_000 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    expect(mustForceAnswer(budget, budget.forceAnswerAfter)).toBe(true);
    s = apply(s, { type: "forceAnswer" }, budget, budget.forceAnswerAfter);
    expect(s.phase).toBe("ANSWER");
  });

  it("rejects forceAnswer before threshold", () => {
    const budget = createRunBudget({ wallClockMs: 10_000 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    const r = next(s, { type: "forceAnswer" }, budget, 0);
    expect(isRejected(r)).toBe(true);
  });

  it("noRetryAfter skips citation retry → DONE", () => {
    const budget = createRunBudget({ wallClockMs: 10_000 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    s = apply(s, { type: "answer", status: "answered" }, budget);
    s = apply(
      s,
      { type: "verify", unknownIds: ["E99"] },
      budget,
      budget.noRetryAfter,
    );
    expect(s.phase).toBe("DONE");
    expect(s.verifyRetries).toBe(0);
  });

  it("verify retry once when under noRetryAfter", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    s = apply(s, { type: "answer", status: "answered" }, budget);
    s = apply(s, { type: "verify", unknownIds: ["E99"] }, budget, 0);
    expect(s.phase).toBe("ANSWER");
    expect(s.verifyRetries).toBe(1);
    s = apply(s, { type: "answer", status: "answered" }, budget);
    s = apply(s, { type: "verify", unknownIds: ["E99"] }, budget, 0);
    expect(s.phase).toBe("DONE");
  });

  it("wallClockExhausted → INSUFFICIENT from non-terminal", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "wallClockExhausted" }, budget);
    expect(s.phase).toBe("INSUFFICIENT");
  });

  it("canSearch becomes false after noNewSearchAfter", () => {
    const budget = createRunBudget({ wallClockMs: 10_000, maxHops: 6 });
    expect(canSearch(budget, budget.noNewSearchAfter - 1, 0)).toBe(true);
    expect(canSearch(budget, budget.noNewSearchAfter, 0)).toBe(false);
  });
});

describe("next — invalid transitions (AC-M2.6)", () => {
  const cases: Array<{
    name: string;
    setup: (b: RunBudget) => AgentState;
    event: AgentEvent;
  }> = [
    {
      name: "searchDone from PLAN",
      setup: () => initialState(),
      event: { type: "searchDone" },
    },
    {
      name: "toolHop from PLAN",
      setup: () => initialState(),
      event: { type: "toolHop" },
    },
    {
      name: "answer from SEARCH",
      setup: (b) => apply(initialState(), { type: "planAccepted" }, b),
      event: { type: "answer", status: "answered" },
    },
    {
      name: "select from SEARCH",
      setup: (b) => apply(initialState(), { type: "planAccepted" }, b),
      event: { type: "select", readIds: [], enough: true },
    },
    {
      name: "readsDone without READ",
      setup: (b) => {
        let s = initialState();
        s = apply(s, { type: "planAccepted" }, b);
        return apply(s, { type: "searchDone" }, b);
      },
      event: { type: "readsDone" },
    },
    {
      name: "event after DONE",
      setup: (b) => happyPathToDone(b),
      event: { type: "planAccepted" },
    },
  ];

  for (const c of cases) {
    it(`rejects ${c.name}`, () => {
      const budget = createRunBudget();
      const state = c.setup(budget);
      const r = next(state, c.event, budget, 0);
      expect(isRejected(r)).toBe(true);
    });
  }

  it("rejects invalid select payload", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    const r = next(
      s,
      { type: "select", readIds: [""], enough: true },
      budget,
      0,
    );
    expect(isRejected(r)).toBe(true);
  });

  it("rejects select exceeding maxReads", () => {
    const budget = createRunBudget({ maxReads: 2 });
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    const r = next(
      s,
      { type: "select", readIds: ["E1", "E2", "E3"], enough: false },
      budget,
      0,
    );
    expect(isRejected(r)).toBe(true);
  });

  it("rejects followup when status is answered", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    const r = next(
      s,
      {
        type: "answer",
        status: "answered",
        followup: { terms: ["x"], phrases: [] },
      },
      budget,
      0,
    );
    expect(isRejected(r)).toBe(true);
  });

  it("rejects invalid answer status", () => {
    const budget = createRunBudget();
    let s = initialState();
    s = apply(s, { type: "planAccepted" }, budget);
    s = apply(s, { type: "searchDone" }, budget);
    s = apply(s, { type: "select", readIds: [], enough: true }, budget);
    const r = next(
      s,
      { type: "answer", status: "maybe" as "answered" },
      budget,
      0,
    );
    expect(isRejected(r)).toBe(true);
  });
});
