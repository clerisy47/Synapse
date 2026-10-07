/**
 * Transport contract: NodeHttpTransport against loopback mock (M1-T09).
 */

import { afterEach, describe, expect, it } from "vitest";

import { NodeHttpTransport } from "../../src/adapters/node";
import { TransportError } from "../../src/core";
import { startMockOllamaServer, type MockServer } from "../mock-ollama/server";

describe("NodeHttpTransport contract (M1-T09)", () => {
  let server: MockServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("exposes streaming + abortable capabilities", () => {
    const t = new NodeHttpTransport();
    expect(t.capabilities).toEqual({ streaming: true, abortable: true });
  });

  it("getJson returns status and parsed body", async () => {
    server = await startMockOllamaServer({
      getJson: () => ({ body: { version: "0.9.0" } }),
    });
    const t = new NodeHttpTransport();
    const res = await t.getJson(`${server.baseUrl}/api/version`, {
      timeoutMs: 2000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: "0.9.0" });
  });

  it("getJson returns non-2xx status without throwing", async () => {
    server = await startMockOllamaServer({
      getJson: () => ({ status: 401, body: { error: "unauthorized" } }),
    });
    const t = new NodeHttpTransport();
    const res = await t.getJson(`${server.baseUrl}/api/version`, {
      timeoutMs: 2000,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("postStream yields one object per NDJSON line", async () => {
    server = await startMockOllamaServer({
      postStream: () => ({
        chunks: [{ n: 1 }, { n: 2 }, { n: 3, done: true }],
      }),
    });
    const t = new NodeHttpTransport();
    const chunks: unknown[] = [];
    for await (const c of t.postStream(
      `${server.baseUrl}/api/chat`,
      { model: "test", stream: true },
      {
        signal: new AbortController().signal,
        firstByteTimeoutMs: 2000,
        idleTimeoutMs: 2000,
      },
    )) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ n: 1 }, { n: 2 }, { n: 3, done: true }]);
  });

  it("abort closes the socket within milliseconds", async () => {
    server = await startMockOllamaServer({
      postStream: () => ({
        chunks: [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }],
        interChunkDelayMs: 200,
      }),
    });
    const t = new NodeHttpTransport();
    const ac = new AbortController();
    const started = Date.now();
    let sawAbort = false;

    const iter = t.postStream(
      `${server.baseUrl}/api/chat`,
      {},
      {
        signal: ac.signal,
        firstByteTimeoutMs: 5000,
        idleTimeoutMs: 5000,
      },
    );

    try {
      for await (const chunk of iter) {
        void chunk;
        ac.abort();
      }
    } catch (err) {
      expect(err).toBeInstanceOf(TransportError);
      expect((err as TransportError).kind).toBe("aborted");
      sawAbort = true;
    }

    const elapsed = Date.now() - started;
    expect(sawAbort).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });

  it("throws timeout_first_byte when the server is silent", async () => {
    server = await startMockOllamaServer({
      postStream: () => ({
        chunks: [{ ok: true }],
        firstByteDelayMs: 500,
      }),
    });
    const t = new NodeHttpTransport();
    await expect(async () => {
      for await (const chunk of t.postStream(
        `${server!.baseUrl}/api/chat`,
        {},
        {
          signal: new AbortController().signal,
          firstByteTimeoutMs: 50,
          idleTimeoutMs: 2000,
        },
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({ kind: "timeout_first_byte" });
  });

  it("throws timeout_idle when chunks stall", async () => {
    server = await startMockOllamaServer({
      postStream: () => ({
        chunks: [{ a: 1 }, { a: 2 }],
        interChunkDelayMs: 400,
      }),
    });
    const t = new NodeHttpTransport();
    await expect(async () => {
      for await (const chunk of t.postStream(
        `${server!.baseUrl}/api/chat`,
        {},
        {
          signal: new AbortController().signal,
          firstByteTimeoutMs: 2000,
          idleTimeoutMs: 80,
        },
      )) {
        void chunk;
      }
    }).rejects.toMatchObject({ kind: "timeout_idle" });
  });

  it("throws refused when nothing listens", async () => {
    const t = new NodeHttpTransport();
    await expect(
      t.getJson("http://127.0.0.1:9/api/version", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "refused" });
  });

  it("throws http on postStream 4xx and clips the body", async () => {
    const long = "x".repeat(500);
    server = await startMockOllamaServer({
      postStream: () => ({
        status: 400,
        chunks: [],
        errorBody: long,
      }),
    });
    const t = new NodeHttpTransport();
    try {
      for await (const chunk of t.postStream(
        `${server.baseUrl}/api/chat`,
        {},
        {
          signal: new AbortController().signal,
          firstByteTimeoutMs: 2000,
          idleTimeoutMs: 2000,
        },
      )) {
        void chunk;
      }
      expect.unreachable("expected TransportError");
    } catch (err) {
      expect(err).toBeInstanceOf(TransportError);
      const te = err as TransportError;
      expect(te.kind).toBe("http");
      expect(te.status).toBe(400);
      expect(te.message.length).toBeLessThanOrEqual(200);
    }
  });

  it("invokes checkEndpoint before opening a socket and maps blocked", async () => {
    server = await startMockOllamaServer();
    let checked = "";
    const t = new NodeHttpTransport({
      checkEndpoint: (url) => {
        checked = url;
        throw new TransportError({ kind: "blocked", message: "denied" });
      },
    });
    await expect(
      t.getJson(`${server.baseUrl}/api/version`, { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "blocked" });
    expect(checked).toContain(server.baseUrl);
  });
});
