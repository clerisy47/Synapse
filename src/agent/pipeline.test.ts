import { fixtureDisclosureAccess } from "../../test/fakes";
import { describe, expect, it } from "vitest";
import { JobContextImpl } from "../jobs";
import type { ModelPort, StructuredRequest } from "../llm";
import {
  createGetBacklinksHandler,
  createGetLinksHandler,
  createListRecentHandler,
  createReadNoteHandler,
  createSearchByTagHandler,
  createSearchByTitleHandler,
  createSearchTextHandler,
  createToolRegistry,
  type ToolRegistry,
} from "../tools";
import { FakeClock, FakeCorpus, ScriptedModel } from "../../test/fakes";
import { createQaPipeline, type QaEvent, type QaStage } from "./pipeline";
import { historyForPrompt } from "./chat-session";

function fullRegistry(corpus: FakeCorpus): ToolRegistry {
  const deps = corpus.asDeps();
  return createToolRegistry({
    handlers: {
      search_text: createSearchTextHandler(deps),
      search_by_title: createSearchByTitleHandler(deps),
      search_by_tag: createSearchByTagHandler(deps),
      list_recent: createListRecentHandler(deps),
      get_links: createGetLinksHandler(deps),
      get_backlinks: createGetBacklinksHandler(deps),
      read_note: createReadNoteHandler(deps),
    },
  });
}

function fixtureCorpus(clock?: FakeClock): FakeCorpus {
  return new FakeCorpus(
    [
      {
        path: "notes/alpha.md",
        title: "Alpha Project",
        tags: ["work"],
        mtime: 1_700_000_100_000,
        text:
          "The quantum rendezvous happens in alpha.\n\n" +
          "More alpha detail about the quantum plan for the team.\n\n" +
          "Closing paragraph with enough characters to pad the excerpt window for read_note coverage in tests.",
      },
      {
        path: "notes/beta.md",
        title: "Beta Notes",
        tags: ["play"],
        mtime: 1_700_000_200_000,
        text: "# Heading with quantum\n\nBeta body without the other term but still readable content for search.",
      },
    ],
    { clock: clock ?? new FakeClock(1_700_000_000_000) },
  );
}

function collectStages(events: QaEvent[]): QaStage[] {
  return events.filter((e) => e.type === "stage").map((e) => e.stage);
}

describe("historyForPrompt", () => {
  it("returns empty when multiTurn is off", () => {
    const turns = historyForPrompt(
      {
        question: "q",
        history: [{ question: "old", answer: "a" }],
      },
      false,
    );
    expect(turns).toEqual([]);
  });

  it("maps last-3 Q/A pairs to prompt turns when on", () => {
    const history = [
      { question: "q0", answer: "a0" },
      { question: "q1", answer: "a1" },
      { question: "q2", answer: "a2" },
      { question: "q3", answer: "a3" },
    ];
    const turns = historyForPrompt({ question: "now", history }, true);
    expect(turns).toEqual([
      { role: "user", text: "q1" },
      { role: "assistant", text: "a1" },
      { role: "user", text: "q2" },
      { role: "assistant", text: "a2" },
      { role: "user", text: "q3" },
      { role: "assistant", text: "a3" },
    ]);
  });
});

describe("QaPipeline.run", () => {
  it.each(["quantum alpha", "quantum alpha beta gamma delta epsilon zeta"])(
    "retrieves separated keywords from a bounded planned group: %s", async terms => {
      const clock = new FakeClock();
      const corpus = fixtureCorpus(clock);
      const model = new ScriptedModel();
      model.enqueue(
        { kind: "qa.plan", value: { searches: [{ tool: "search_text", terms: [terms], phrases: [], tag: null, days: null }], expand_graph: false } },
        { kind: "qa.select", value: { read: ["E1"], enough: false } },
        { kind: "qa.answer", value: { status: "answered", claims: [{ text: "The rendezvous is in alpha.", sources: ["E1"] }], followup: null } },
      );
      const ctx = new JobContextImpl(clock);
      ctx.beginAttempt();
      const pipeline = createQaPipeline({ access: fixtureDisclosureAccess(), model,
        tools: fullRegistry(corpus), readText: path => corpus.vault.readText(path) });
      const result = await pipeline.run({ question: "Where is the quantum rendezvous?", history: [] }, ctx, () => undefined);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("answered");
      expect(result.value.trace.find(hop => hop.tool === "search_text")?.resultCount).toBeGreaterThan(0);
      expect(result.value.claims[0]?.sourced).toBe(true);
      expect(result.value.claims[0]?.citations[0]?.status).toBe("sourced");
    },
  );

  it("preserves nonmatching exact phrases while normalizing keywords", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue(
      { kind: "qa.plan", value: { searches: [{ tool: "search_text", terms: ["absent missing"], phrases: ["quantum alpha"], tag: null, days: null }], expand_graph: false } },
      { kind: "qa.select", value: { read: [], enough: false } },
      { kind: "qa.answer", value: { status: "insufficient", claims: [], followup: null } },
    );
    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({ access: fixtureDisclosureAccess(), model,
      tools: fullRegistry(corpus), readText: path => corpus.vault.readText(path) });
    const result = await pipeline.run({ question: "Find the exact phrase.", history: [] }, ctx, () => undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("insufficient");
    expect(result.value.trace.find(hop => hop.tool === "search_text")?.resultCount).toBe(0);
    expect(result.value.claims).toEqual([]);
  });

  it("happy path: plan→search→select→read→answer→verify with sourced claims", async () => {
    const clock = new FakeClock(1_700_000_000_000);
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      {
        kind: "qa.select",
        value: { read: ["E1"], enough: false },
      },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "Quantum rendezvous is in alpha.", sources: ["E1"] }],
          followup: null,
        },
      },
    );

    const events: QaEvent[] = [];
    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();

    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });

    const result = await pipeline.run(
      { question: "Where is the quantum rendezvous?", history: [] },
      ctx,
      (e) => events.push(e),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("answered");
    expect(result.value.claims.length).toBe(1);
    expect(result.value.claims[0]?.sourced).toBe(true);
    expect(result.value.claims[0]?.citations[0]?.status).toBe("sourced");
    expect(result.value.trace.some((h) => h.tool === "search_text")).toBe(true);
    expect(collectStages(events)[0]).toBe("queued");
    expect(collectStages(events)[1]).toBe("planning");
    expect(collectStages(events)).toContain("verifying");
    expect(model.remaining()).toBe(0);
  });

  it("duplicate tool call counts as hop (AC-M2.5)", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      {
        kind: "qa.select",
        value: { read: [], enough: true },
      },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "Found it.", sources: ["E1"] }],
          followup: null,
        },
      },
    );

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });

    const result = await pipeline.run(
      { question: "q", history: [] },
      ctx,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dup = result.value.trace.find((h) => h.rejected === "duplicate");
    expect(dup).toBeDefined();
    expect(result.value.stats.hops).toBeGreaterThanOrEqual(2);
  });

  it("unknown citation IDs → retry → unverified (AC-M3.4)", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      {
        kind: "qa.select",
        value: { read: [], enough: true },
      },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "Forged cite.", sources: ["E999"] }],
          followup: null,
        },
      },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "Still forged.", sources: ["E999"] }],
          followup: null,
        },
      },
    );

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });

    const result = await pipeline.run(
      { question: "q", history: [] },
      ctx,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("answered");
    expect(result.value.claims[0]?.sourced).toBe(false);
    expect(result.value.stats.modelCalls).toBeGreaterThanOrEqual(3);
  });

  it("hop cap still allows the model to decline unsupported claims (AC-M3.6)", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.plan",
      value: {
        searches: [
          {
            tool: "search_text",
            terms: ["quantum"],
            phrases: [],
            tag: null,
            days: null,
          },
          {
            tool: "search_by_title",
            terms: ["Alpha"],
            phrases: [],
            tag: null,
            days: null,
          },
          {
            tool: "search_by_tag",
            terms: [],
            phrases: [],
            tag: "work",
            days: null,
          },
        ],
        expand_graph: false,
      },
    });

    model.enqueue({ kind: "qa.answer", value: { status: "insufficient", claims: [], followup: null } });

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
      budget: { maxHops: 2 },
    });

    const result = await pipeline.run(
      { question: "never satisfied", history: [] },
      ctx,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("insufficient");
    expect(result.value.claims).toEqual([]);
    expect(result.value.stats.hops).toBe(2);
    expect(result.value.stats.modelCalls).toBe(2);
    expect(model.remaining()).toBe(0);
  });

  it("emits hop trace (AC-M3.5)", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      { kind: "qa.select", value: { read: [], enough: true } },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "ok", sources: ["E1"] }],
          followup: null,
        },
      },
    );

    const hops: unknown[] = [];
    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });
    const result = await pipeline.run(
      { question: "q", history: [] },
      ctx,
      (e) => {
        if (e.type === "hop") hops.push(e.hop);
      },
    );
    expect(result.ok).toBe(true);
    expect(hops.length).toBeGreaterThan(0);
  });

  it("multiTurn false ignores history in plan prompt", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    let planInput = "";
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      { kind: "qa.select", value: { read: [], enough: true } },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "ok", sources: ["E1"] }],
          followup: null,
        },
      },
    );

    const wrapped: ModelPort = {
      generate<T>(req: StructuredRequest<T>, signal: AbortSignal) {
        if (req.kind === "qa.plan") {
          planInput = req.input;
        }
        return model.generate(req, signal);
      },
    };

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model: wrapped,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
      multiTurn: false,
    });
    await pipeline.run(
      {
        question: "now",
        history: [{ question: "secret prior", answer: "secret answer" }],
      },
      ctx,
      () => undefined,
    );
    expect(planInput).not.toContain("secret prior");
    expect(planInput).toContain("Question: now");
  });

  it("multiTurn true includes last-3 history in plan prompt", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    let planInput = "";
    model.enqueue(
      {
        kind: "qa.plan",
        value: {
          searches: [
            {
              tool: "search_text",
              terms: ["quantum"],
              phrases: [],
              tag: null,
              days: null,
            },
          ],
          expand_graph: false,
        },
      },
      { kind: "qa.select", value: { read: [], enough: true } },
      {
        kind: "qa.answer",
        value: {
          status: "answered",
          claims: [{ text: "ok", sources: ["E1"] }],
          followup: null,
        },
      },
    );

    const wrapped: ModelPort = {
      generate<T>(req: StructuredRequest<T>, signal: AbortSignal) {
        if (req.kind === "qa.plan") {
          planInput = req.input;
        }
        return model.generate(req, signal);
      },
    };

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model: wrapped,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
      multiTurn: true,
    });
    await pipeline.run(
      {
        question: "now",
        history: [{ question: "prior q", answer: "prior a", accessVersion: "fixture" }],
      },
      ctx,
      () => undefined,
    );
    expect(planInput).toContain("prior q");
    expect(planInput).toContain("prior a");
  });

  it("abort mid-run returns CANCELLED", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    // No scripted steps — abort before plan completes via pre-aborted ctx
    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    ctx.abort({ kind: "cancelled" });

    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });
    const result = await pipeline.run(
      { question: "q", history: [] },
      ctx,
      () => undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CANCELLED");
  });

  it("empty plan → insufficient", async () => {
    const clock = new FakeClock();
    const corpus = fixtureCorpus(clock);
    const model = new ScriptedModel();
    model.enqueue({
      kind: "qa.plan",
      value: {
        searches: [
          {
            tool: "search_by_tag",
            terms: [],
            phrases: [],
            tag: null,
            days: null,
          },
        ],
        expand_graph: false,
      },
    });

    const ctx = new JobContextImpl(clock);
    ctx.beginAttempt();
    const pipeline = createQaPipeline({
      access: fixtureDisclosureAccess(),
      model,
      tools: fullRegistry(corpus),
      readText: (path) => corpus.vault.readText(path),
    });
    const result = await pipeline.run(
      { question: "q", history: [] },
      ctx,
      () => undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("insufficient");
    expect(result.value.claims).toEqual([]);
  });
});

it("filters unprovenanced/stale history and keeps exactly the latest three valid pairs", () => {
  const input = { question: "now", history: [
    { question: "legacy", answer: "legacy answer" },
    { question: "stale", answer: "stale answer", accessVersion: "old" },
    ...[1, 2, 3, 4].map((n) => ({ question: `question-${n}`, answer: `answer-${n}`, accessVersion: "fixture" })),
  ] };
  const history = historyForPrompt(input, true, fixtureDisclosureAccess());
  expect(history).toHaveLength(6);
  expect(history.map((turn) => turn.text)).toEqual(["question-2", "answer-2", "question-3", "answer-3", "question-4", "answer-4"]);
});

it("fails closed without a disclosure boundary even for an untyped caller", async () => {
  const corpus = fixtureCorpus();
  const model = new ScriptedModel();
  model.enqueue({ kind: "qa.plan", value: { searches: [], expand_graph: false } });
  const ctx = new JobContextImpl(corpus.clock);
  ctx.beginAttempt();
  const result = await createQaPipeline({ access: undefined as never, model, tools: fullRegistry(corpus), readText: (path) => corpus.vault.readText(path) })
    .run({ question: "private", history: [] }, ctx, () => {});
  expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
  expect(model.remaining()).toBe(1);
});
