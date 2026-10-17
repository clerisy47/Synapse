import { expect, it } from "vitest";
import { NodeHttpTransport } from "../../src/adapters/node";
import { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } from "../../src/constants";
import { ok } from "../../src/core";
import { createJobQueue } from "../../src/jobs";
import { BonsaiClient, OpenRouterHealthChecker } from "../../src/llm";
import { createEndpointPolicy } from "../../src/policy";
import { FakeClock } from "../fakes";

it.skipIf(process.env.SYNAPSE_LIVE_BONSAI !== "1")("Bonsai live full health uses the production queue and builder", async () => {
  const policy = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const transport = new NodeHttpTransport({ checkEndpoint: url => policy.assertAllowed(url) });
  const clock = new FakeClock(); clock.now = () => Date.now(); clock.mono = () => performance.now();
  const model = new BonsaiClient({ transport, endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL });
  const health = new OpenRouterHealthChecker({ provider: "bonsai", transport, model, endpoint: DEFAULT_BONSAI_ENDPOINT, modelId: DEFAULT_BONSAI_MODEL, numCtx: 4096, apiKey: null, clock });
  const jobs = createJobQueue({ clock, abortable: true });
  try {
    const started = performance.now();
    const result = await jobs.submit({ kind: "health", label: "synthetic health", run: async ctx => ok(await health.full(ctx.signal)) }).result;
    const ready = result.ok && result.value.server.ok && result.value.structured !== "skipped" && result.value.structured.ok;
    console.info("Bonsai live health", JSON.stringify({ ready, elapsedMs: Math.round(performance.now() - started) }));
    expect(ready).toBe(true);
    expect(health.availability.get().state).toBe("ready");
  } finally { jobs.dispose(); }
}, 120_000);
