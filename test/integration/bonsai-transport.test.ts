import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { NodeHttpTransport } from "../../src/adapters/node";
import { BonsaiClient, healthOutputSchema } from "../../src/llm";
import { createEndpointPolicy } from "../../src/policy";
import { createJobQueue } from "../../src/jobs";
import { FakeClock } from "../fakes";

it("cancels queued production Bonsai work and closes its in-flight HTTP socket", async () => {
  let received!: () => void;
  let closed!: () => void;
  const requested = new Promise<void>(resolve => { received = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = http.createServer((req, res) => {
    req.resume();
    res.on("close", closed);
    received(); // Leave the response pending until cancellation destroys the socket.
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const policy = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const transport = new NodeHttpTransport({ checkEndpoint: url => policy.assertAllowed(url) });
  const model = new BonsaiClient({ transport, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: "bonsai-2-9b" });
  const jobs = createJobQueue({ clock: new FakeClock(), abortable: true });
  try {
    const job = jobs.submit({ kind: "qa", label: "synthetic cancellation", run: ctx => model.generate({ kind: "health", instructions: "Return ok", input: "{}", schema: healthOutputSchema, numPredict: 32 }, ctx.signal) });
    await requested;
    job.cancel();
    const result = await job.result;
    expect(!result.ok && result.error.code).toBe("CANCELLED");
    await disconnected;
    expect(job.state.get()).toBe("cancelled");
  } finally {
    jobs.dispose(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("does not follow a loopback server redirect to a cloud endpoint", async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    req.resume(); requests++;
    res.writeHead(307, { Location: "https://openrouter.ai/api/v1/chat/completions", "Content-Type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const policy = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const model = new BonsaiClient({ transport: new NodeHttpTransport({ checkEndpoint: url => policy.assertAllowed(url) }), endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: "bonsai-2-9b" });
  try {
    const result = await model.generate({ kind: "health", instructions: "Return ok", input: "{}", schema: healthOutputSchema, numPredict: 32 }, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(requests).toBe(1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
