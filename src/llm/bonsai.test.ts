import { describe, expect, it } from "vitest";
import { BonsaiClient, OpenRouterHealthChecker, buildBonsaiChatRequest, healthOutputSchema } from "./index";
import { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } from "../constants";
import { FakeClock, FakeTransport } from "../../test/fakes";
import { type Transport } from "../core";

const request = { kind: "health" as const, instructions: "Return ok", input: "{}", schema: healthOutputSchema, numPredict: 512 };
const chunk = (content: string) => ({ choices: [{ message: { content } }] });
const client = (transport: Transport) => new BonsaiClient({ transport, endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL });

describe("local Bonsai", () => {
  it("uses the small-model non-thinking profile and bounded schema grammar even for planning", () => {
    const body = buildBonsaiChatRequest({ kind: "qa.plan", model: DEFAULT_BONSAI_MODEL, instructions: "plan", input: "{}", maxTokens: null });
    expect(body).toMatchObject({ max_tokens: 1024, temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1, repeat_last_n: 64, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_schema", json_schema: { strict: true } } });
  });
  it("requires no key and validates runtime JSON with one schema retry", async () => {
    const t = new FakeTransport();
    t.enqueuePostStream({ chunks: [chunk('{"ok":"yes"}')] });
    t.enqueuePostStream({ chunks: [chunk('{"ok":true}')] });
    const result = await client(t).generate(request, new AbortController().signal);
    expect(result.ok && result.value.attempts).toBe(2);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0]?.headers).toEqual({});
    expect(t.calls[0]?.url).toBe(`${DEFAULT_BONSAI_ENDPOINT}/chat/completions`);
  });
  it.each(["not JSON", '{"ok":"yes"}'])("fails visibly on invalid output: %s", async (text) => {
    const t = new FakeTransport();
    for (let i = 0; i < 2; i++) t.enqueuePostStream({ chunks: [chunk(text)] });
    const result = await client(t).generate(request, new AbortController().signal);
    expect(result.ok).toBe(false);
  });
  it("returns actionable offline errors without a cloud request", async () => {
    const t = new FakeTransport();
    t.enqueuePostStream({ error: { kind: "refused", message: "sensitive runtime diagnostic" } });
    const result = await client(t).generate(request, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.remediation).toBe("bonsai_runtime");
      expect(JSON.stringify(result.error)).not.toContain("sensitive runtime diagnostic");
    }
    expect(t.calls).toHaveLength(1);
  });
  it("discards late completions from a non-abortable transport", async () => {
    const controller = new AbortController();
    const t: Transport = { capabilities: { streaming: false, abortable: false }, getJson: async () => ({ status: 200, body: {} }),
      async *postStream() { controller.abort(); yield chunk('{"ok":true}'); } };
    const result = await client(t).generate(request, controller.signal);
    expect(!result.ok && result.error.code).toBe("CANCELLED");
  });
  it("never submits a pre-cancelled request or a stale-policy retry", async () => {
    const t = new FakeTransport();
    const controller = new AbortController(); controller.abort();
    expect((await client(t).generate(request, controller.signal)).ok).toBe(false);
    expect(t.calls).toHaveLength(0);
    t.enqueuePostStream({ chunks: [chunk('{"ok":"yes"}')] });
    let checks = 0;
    const result = await client(t).generate({ ...request, isCurrent: () => ++checks <= 3 }, new AbortController().signal);
    expect(!result.ok && result.error.code).toBe("ACCESS_DENIED");
    expect(t.calls).toHaveLength(1);
  });
  it("health uses /health and the production generation builder", async () => {
    const t = new FakeTransport(); t.enqueueGet({ status: 200, body: { status: "ok" } });
    t.enqueuePostStream({ chunks: [chunk('{"ok":true}')] });
    const health = new OpenRouterHealthChecker({ provider: "bonsai", transport: t, model: client(t), endpoint: DEFAULT_BONSAI_ENDPOINT, modelId: DEFAULT_BONSAI_MODEL, apiKey: null, numCtx: 4096, clock: new FakeClock() });
    const report = await health.full(new AbortController().signal);
    expect(report.structured).toEqual({ ok: true });
    expect(health.availability.get().state).toBe("ready");
    expect(t.calls[0]?.url).toBe("http://127.0.0.1:18080/health");
    expect(t.calls[1]?.body).toMatchObject({ response_format: { type: "json_schema" } });
  });
});


it.each([503, 404, 401])("Bonsai health HTTP %s is actionable and disables inference", async (status) => {
  const t = new FakeTransport(); t.enqueueGet({ status, body: {} });
  const health = new OpenRouterHealthChecker({ provider: "bonsai", transport: t, model: client(t), endpoint: DEFAULT_BONSAI_ENDPOINT, modelId: DEFAULT_BONSAI_MODEL, apiKey: null, numCtx: 4096, clock: new FakeClock() });
  const report = await health.full(new AbortController().signal);
  expect(report.server.error?.remediation).toBe("bonsai_runtime");
  expect(health.availability.get().state).toBe("disabled");
  expect(t.calls).toHaveLength(1);
});
it("negative structured health never marks the model ready", async () => {
  const t = new FakeTransport(); t.enqueueGet({ status: 200, body: {} });
  t.enqueuePostStream({ chunks: [chunk('{"ok":false}')] });
  const health = new OpenRouterHealthChecker({ provider: "bonsai", transport: t, model: client(t), endpoint: DEFAULT_BONSAI_ENDPOINT, modelId: DEFAULT_BONSAI_MODEL, apiKey: null, numCtx: 4096, clock: new FakeClock() });
  const report = await health.full(new AbortController().signal);
  expect(report.structured).toMatchObject({ ok: false });
  expect(health.availability.get().state).toBe("disabled");
});
