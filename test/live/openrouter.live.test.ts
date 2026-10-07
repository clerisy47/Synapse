/**
 * Optional live probe — skipped unless OPENROUTER_API_KEY is set.
 * Never commit the key.
 */

import { describe, expect, it } from "vitest";

import { NodeHttpTransport } from "../../src/adapters/node";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
  NUM_PREDICT,
  OPENROUTER_API_KEY_ENV,
} from "../../src/constants";
import { OpenRouterClient, healthOutputSchema } from "../../src/llm";

describe("OpenRouter live probe", () => {
  it.skipIf(!process.env[OPENROUTER_API_KEY_ENV])(
    "health-shaped structured call returns valid JSON",
    async () => {
      const transport = new NodeHttpTransport();
      const client = new OpenRouterClient({
        transport,
        endpoint: DEFAULT_OPENROUTER_BASE_URL,
        model: DEFAULT_OPENROUTER_MODEL,
        apiKey: process.env[OPENROUTER_API_KEY_ENV] ?? null,
      });
      const r = await client.generate(
        {
          kind: "health",
          instructions:
            'Return a JSON object with a single boolean field "ok" set to true.',
          input: "{}",
          schema: healthOutputSchema,
          numPredict: NUM_PREDICT.health,
        },
        new AbortController().signal,
      );
      expect(r.ok).toBe(true);
    },
    60_000,
  );
});
