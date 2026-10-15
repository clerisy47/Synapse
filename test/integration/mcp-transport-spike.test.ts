/** R4-T01 feasibility only; deliberately not shipped in the plugin. */
import { createServer, request as httpRequest } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

describe("local MCP transport feasibility", () => {
  it("binds loopback, authenticates, blocks browser/rebinding, revokes and closes", async () => {
    const token = randomBytes(32).toString("base64url");
    const digest = (value: string) => createHash("sha256").update(value).digest();
    const expected = digest(`Bearer ${token}`);
    let revoked = false;
    let host = "";
    const server = createServer((req, res) => {
      if (req.headers.origin !== undefined || req.headers.host !== host) {
        res.writeHead(403).end();
      } else if (revoked || !timingSafeEqual(digest(req.headers.authorization ?? ""), expected)) {
        res.writeHead(401).end();
      } else if (req.method !== "POST" || req.url !== "/mcp") {
        res.writeHead(405).end();
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { synthetic: true } }));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    host = `127.0.0.1:${address.port}`;
    const url = `http://${host}/mcp`;
    const request = (headers: Record<string, string> = {}) => fetch(url, {
      method: "POST", headers, body: "{}",
    });
    try {
      expect(address.address).toBe("127.0.0.1");
      expect((await request()).status).toBe(401);
      expect((await request({ Authorization: "Bearer wrong" })).status).toBe(401);
      const auth = { Authorization: `Bearer ${token}` };
      expect((await request({ ...auth, Origin: "https://example.invalid" })).status).toBe(403);
      expect((await request({ ...auth, Origin: "null" })).status).toBe(403);
      const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(url, { method: "POST", headers: { ...auth, Host: "attacker.invalid" } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.end("{}");
      });
      expect(forgedHostStatus).toBe(403);
      const accepted = await request(auth);
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { synthetic: true } });
      revoked = true;
      expect((await request(auth)).status).toBe(401);
    } finally {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
    await expect(request()).rejects.toThrow();
  });
});
