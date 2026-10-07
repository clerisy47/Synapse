import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  NUM_PREDICT,
} from "../constants";
import { FakeTransport } from "../../test/fakes";
import { OpenRouterClient } from "./client";
import { healthOutputSchema } from "./schemas";
import { SHARED_SYSTEM_PREFIX } from "./request";

function chatChunk(content: string, usage?: {
  prompt_tokens: number;
  completion_tokens: number;
}): unknown {
  return {
    choices: [{ message: { content } }],
    usage: usage ?? { prompt_tokens: 1, completion_tokens: 1 },
  };
}

function client(transport: FakeTransport, apiKey: string | null = "test-key") {
  return new OpenRouterClient({
    transport,
    endpoint: DEFAULT_OPENROUTER_BASE_URL,
    model: DEFAULT_OPENROUTER_MODEL,
    apiKey,
  });
}

describe("OpenRouterClient", () => {
  it("does not call transport when API key is missing", async () => {
    const transport = new FakeTransport();
    const c = client(transport, null);
    const r = await c.generate(
      {
        kind: "health",
        instructions: "ok",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MODEL_HTTP_ERROR");
      expect(r.error.remediation).toBe("set_api_key");
    }
    expect(transport.calls).toHaveLength(0);
  });

  it("sends Bearer auth and production request shape", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      chunks: [chatChunk('{"ok":true}')],
    });
    const c = client(transport);
    const r = await c.generate(
      {
        kind: "health",
        instructions: "Return ok",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.value).toEqual({ ok: true });
      expect(r.value.attempts).toBe(1);
      expect(r.value.usage.promptTokens).toBe(1);
    }
    expect(transport.calls).toHaveLength(1);
    const call = transport.calls[0];
    expect(call?.method).toBe("postStream");
    expect(call?.url).toBe(`${DEFAULT_OPENROUTER_BASE_URL}/chat/completions`);
    expect(call?.headers?.Authorization).toBe("Bearer test-key");
    expect(call?.body).toMatchObject({
      model: DEFAULT_OPENROUTER_MODEL,
      temperature: 0,
      max_tokens: NUM_PREDICT.health,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SHARED_SYSTEM_PREFIX },
        { role: "user", content: "Return ok\n\n{}" },
      ],
    });
  });

  it("classifies HTTP 401 as auth failure", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      error: { kind: "http", status: 401, message: "unauthorized" },
    });
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MODEL_HTTP_ERROR");
      expect(r.error.remediation).toBe("auth_failed");
    }
  });

  it("classifies HTTP 429 as rate limit", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      error: { kind: "http", status: 429, message: "slow down" },
    });
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.remediation).toBe("rate_limited");
    }
  });

  it("returns FORMAT_IGNORED without retry for non-JSON content", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      chunks: [chatChunk("not-json")],
    });
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORMAT_IGNORED");
    expect(transport.calls).toHaveLength(1);
  });

  it("retries once on SCHEMA_INVALID then succeeds", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      chunks: [chatChunk('{"ok":"nope"}')],
    });
    transport.enqueuePostStream({
      chunks: [chatChunk('{"ok":true}')],
    });
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.attempts).toBe(2);
    expect(transport.calls).toHaveLength(2);
    const retryBody = transport.calls[1]?.body as {
      messages: { role: string; content: string }[];
    };
    expect(retryBody.messages).toHaveLength(3);
    expect(retryBody.messages[2]?.content).toContain("SCHEMA_INVALID");
  });

  it("fails after schema retry still invalid", async () => {
    const transport = new FakeTransport();
    transport.enqueuePostStream({
      chunks: [chatChunk('{"ok":"a"}')],
    });
    transport.enqueuePostStream({
      chunks: [chatChunk('{"ok":"b"}')],
    });
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SCHEMA_INVALID");
    expect(transport.calls).toHaveLength(2);
  });

  it("returns CANCELLED when signal is aborted", async () => {
    const transport = new FakeTransport();
    const ac = new AbortController();
    ac.abort();
    const r = await client(transport).generate(
      {
        kind: "health",
        instructions: "x",
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      ac.signal,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CANCELLED");
    expect(transport.calls).toHaveLength(0);
  });
});

