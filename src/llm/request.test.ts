import { describe, expect, it } from "vitest";

import {
  SHARED_SYSTEM_PREFIX,
  buildOpenRouterChatRequest,
  joinEndpoint,
} from "./request";
import type { PromptKind } from "./schemas";

const KINDS: PromptKind[] = [
  "health",
  "qa.plan",
  "qa.select",
  "qa.answer",
  "claims.extract",
  "compare.contradiction",
  "compare.relevance",
];

describe("buildOpenRouterChatRequest", () => {
  it("emits the production OpenRouter shape", () => {
    const body = buildOpenRouterChatRequest({
      model: "qwen/qwen3.8-27b:free",
      instructions: "Return ok",
      input: "{}",
      maxTokens: 16,
    });
    expect(body).toEqual({
      model: "qwen/qwen3.8-27b:free",
      messages: [
        { role: "system", content: SHARED_SYSTEM_PREFIX },
        { role: "user", content: "Return ok\n\n{}" },
      ],
      temperature: 0,
      max_tokens: 16,
      response_format: { type: "json_object" },
    });
  });

  it("keeps SHARED_SYSTEM_PREFIX byte-identical across kinds", () => {
    const prefixes = KINDS.map((kind) =>
      buildOpenRouterChatRequest({
        model: "m",
        instructions: kind,
        input: "x",
        maxTokens: 10,
      }).messages[0]?.content,
    );
    expect(new Set(prefixes).size).toBe(1);
    expect(prefixes[0]).toBe(SHARED_SYSTEM_PREFIX);
  });

  it("appends validation feedback as a second user message", () => {
    const body = buildOpenRouterChatRequest({
      model: "m",
      instructions: "a",
      input: "b",
      maxTokens: 8,
      validationFeedback: "fix it",
    });
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({ role: "user", content: "fix it" });
  });
});

describe("joinEndpoint", () => {
  it("joins base and path without double slashes", () => {
    expect(joinEndpoint("https://openrouter.ai/api/v1", "/key")).toBe(
      "https://openrouter.ai/api/v1/key",
    );
    expect(joinEndpoint("https://openrouter.ai/api/v1/", "/key")).toBe(
      "https://openrouter.ai/api/v1/key",
    );
  });
});
