import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../constants";
import { FakeClock, FakeTransport } from "../../test/fakes";
import { OpenRouterClient } from "./client";
import { OpenRouterHealthChecker } from "./health";
import { SHARED_SYSTEM_PREFIX } from "./request";

function make(apiKey: string | null = "test-key") {
  const transport = new FakeTransport();
  const clock = new FakeClock(1_700_000_000_000);
  const model = new OpenRouterClient({
    transport,
    endpoint: DEFAULT_OPENROUTER_BASE_URL,
    model: DEFAULT_OPENROUTER_MODEL,
    apiKey,
  });
  const health = new OpenRouterHealthChecker({
    transport,
    model,
    endpoint: DEFAULT_OPENROUTER_BASE_URL,
    modelId: DEFAULT_OPENROUTER_MODEL,
    apiKey,
    numCtx: 4096,
    clock,
  });
  return { transport, clock, model, health };
}

describe("OpenRouterHealthChecker", () => {
  it("quick skips structured and disables when key missing", async () => {
    const { transport, health } = make(null);
    const report = await health.quick();
    expect(report.structured).toBe("skipped");
    expect(report.server.ok).toBe(false);
    expect(report.server.error?.remediation).toBe("set_api_key");
    expect(transport.calls).toHaveLength(0);
    expect(health.availability.get().state).toBe("disabled");
  });

  it("quick succeeds on GET /key without chat completions", async () => {
    const { transport, health } = make();
    transport.enqueueGet({
      status: 200,
      body: { data: { label: "default" } },
    });
    const report = await health.quick();
    expect(report.server.ok).toBe(true);
    expect(report.server.version).toBe("default");
    expect(report.structured).toBe("skipped");
    expect(report.fingerprint).toContain(DEFAULT_OPENROUTER_MODEL);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe(
      `${DEFAULT_OPENROUTER_BASE_URL}/key`,
    );
    expect(transport.calls[0]?.headers?.Authorization).toBe("Bearer test-key");
    expect(health.availability.get().state).toBe("unknown");
  });

  it("quick classifies 401 on /key", async () => {
    const { transport, health } = make();
    transport.enqueueGet({ status: 401, body: { error: "bad key" } });
    const report = await health.quick();
    expect(report.server.ok).toBe(false);
    expect(report.server.error?.remediation).toBe("auth_failed");
    expect(health.availability.get().state).toBe("disabled");
  });

  it("full uses the same production request shape as generate", async () => {
    const { transport, health } = make();
    transport.enqueueGet({
      status: 200,
      body: { data: { label: "default" } },
    });
    transport.enqueuePostStream({
      chunks: [
        {
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        },
      ],
    });
    const report = await health.full(new AbortController().signal);
    expect(report.structured).toEqual({ ok: true });
    expect(report.model.ok).toBe(true);
    expect(health.availability.get().state).toBe("ready");

    const post = transport.calls.find((c) => c.method === "postStream");
    expect(post).toBeDefined();
    const body = post?.body as {
      model: string;
      temperature: number;
      response_format: { type: string };
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({
      role: "system",
      content: SHARED_SYSTEM_PREFIX,
    });
    expect(body.messages[1]?.role).toBe("user");
  });

  it("full records FORMAT_IGNORED on structured facet", async () => {
    const { transport, health } = make();
    transport.enqueueGet({
      status: 200,
      body: { data: { label: "default" } },
    });
    transport.enqueuePostStream({
      chunks: [
        {
          choices: [{ message: { content: "plain text" } }],
        },
      ],
    });
    const report = await health.full(new AbortController().signal);
    expect(report.structured).not.toBe("skipped");
    if (report.structured !== "skipped") {
      expect(report.structured.ok).toBe(false);
      expect(report.structured.formatIgnored).toBe(true);
    }
    expect(health.availability.get().state).toBe("disabled");
  });
});
