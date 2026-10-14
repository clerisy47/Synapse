import { expect, it } from "vitest";
import { TransportError, type Transport } from "../core";
import { OpenRouterClient } from "./client";
import { healthOutputSchema } from "./schemas";

it.each(["success", "invalid-schema", "http-retry"])("rechecks physical requests and drops stale %s responses", async (mode) => {
  let current = true;
  let calls = 0;
  const transport: Transport = {
    capabilities: { abortable: false, streaming: false },
    getJson: async () => ({ status: 200, body: {} }),
    async *postStream() {
      calls++; current = false;
      if (mode === "http-retry") throw new TransportError({ kind: "http", status: 503 });
      yield { choices: [{ message: { content: mode === "success" ? '{"ok":true}' : '{"wrong":true}' } }] };
    },
  };
  const client = new OpenRouterClient({ transport, endpoint: "https://openrouter.ai/api/v1", model: "openrouter/free", apiKey: "synthetic" });
  const result = await client.generate({ kind: "health", instructions: "health", input: "{}", schema: healthOutputSchema, numPredict: 10, isCurrent: () => current }, new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
  expect(calls).toBe(1);
});
it("denies a request that is already stale before transport", async () => {
  let calls = 0;
  const transport: Transport = {
    capabilities: { abortable: false, streaming: false }, getJson: async () => ({ status: 200, body: {} }),
    async *postStream() { calls++; yield {}; },
  };
  const client = new OpenRouterClient({ transport, endpoint: "https://openrouter.ai/api/v1", model: "openrouter/free", apiKey: "synthetic" });
  const result = await client.generate({ kind: "health", instructions: "health", input: "{}", schema: healthOutputSchema, numPredict: 10, isCurrent: () => false }, new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
  expect(calls).toBe(0);
});
