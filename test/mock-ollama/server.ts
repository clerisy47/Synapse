/**
 * Loopback mock HTTP server for Transport contract tests (PLAN M1-T09).
 * Speaks a thin Ollama-like surface: GET JSON + POST NDJSON streams.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

export type MockRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

export type MockGetJsonHandler = (req: MockRequest) => {
  status?: number;
  body: unknown;
  /** Delay before writing the response body (ms). */
  delayMs?: number;
};

export type MockPostStreamHandler = (req: MockRequest) => {
  status?: number;
  /** NDJSON objects; each becomes one line. */
  chunks: unknown[];
  /** Delay before the first byte (ms). */
  firstByteDelayMs?: number;
  /** Delay between successive NDJSON lines (ms). */
  interChunkDelayMs?: number;
  /** Raw error body when status >= 400. */
  errorBody?: string;
};

export type MockServerOptions = {
  getJson?: MockGetJsonHandler;
  postStream?: MockPostStreamHandler;
};

export type MockServer = {
  baseUrl: string;
  port: number;
  close: () => Promise<void>;
};

export async function startMockOllamaServer(
  opts: MockServerOptions = {},
): Promise<MockServer> {
  const server = http.createServer((req, res) => {
    void handle(req, res, opts);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: MockServerOptions,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const mockReq: MockRequest = {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    headers: req.headers,
    body,
  };

  try {
    if (mockReq.method === "GET") {
      const handler = opts.getJson ?? defaultGetJson;
      const result = handler(mockReq);
      if (result.delayMs !== undefined && result.delayMs > 0) {
        await sleep(result.delayMs);
      }
      const status = result.status ?? 200;
      const payload = JSON.stringify(result.body);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }

    if (mockReq.method === "POST") {
      const handler = opts.postStream ?? defaultPostStream;
      const result = handler(mockReq);
      const status = result.status ?? 200;

      if (status >= 400) {
        const errBody = result.errorBody ?? JSON.stringify({ error: "fail" });
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(errBody);
        return;
      }

      res.writeHead(status, { "Content-Type": "application/x-ndjson" });

      if (result.firstByteDelayMs !== undefined && result.firstByteDelayMs > 0) {
        await sleep(result.firstByteDelayMs);
      }

      for (let i = 0; i < result.chunks.length; i++) {
        if (i > 0 && result.interChunkDelayMs !== undefined && result.interChunkDelayMs > 0) {
          await sleep(result.interChunkDelayMs);
        }
        if (res.writableEnded || res.destroyed) return;
        const line = `${JSON.stringify(result.chunks[i])}\n`;
        const ok = res.write(line);
        if (!ok) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
      return;
    }

    res.writeHead(405).end();
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

const defaultGetJson: MockGetJsonHandler = () => ({
  body: { version: "0.9.0" },
});

const defaultPostStream: MockPostStreamHandler = () => ({
  chunks: [
    { message: { content: "hel" }, done: false },
    { message: { content: "lo" }, done: false },
    { message: { content: "" }, done: true, done_reason: "stop" },
  ],
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
