/** Test-only OpenRouter chat-completions server; never contacts a provider. */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type MockRequest = {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

export async function startMockOpenRouterServer(outputs: readonly unknown[]) {
  const pending = [...outputs];
  const requests: MockRequest[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (req.method !== "POST" || req.url !== "/api/v1/chat/completions") {
          res.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          const bytes: unknown = chunk;
          if (!(bytes instanceof Uint8Array)) throw new Error("Unexpected request chunk");
          chunks.push(Buffer.from(bytes));
        }
        requests.push({
          url: req.url,
          headers: req.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        });
        if (pending.length === 0) {
          res.writeHead(500).end();
          return;
        }
        const payload = JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify(pending.shift()) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      } catch {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    endpoint: `${origin}/api/v1`,
    requests,
    remaining: () => pending.length,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
