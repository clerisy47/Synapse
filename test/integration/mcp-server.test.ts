import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../../src/adapters/node";
import { MCP_LIMITS } from "../../src/constants";
import type { McpServerOptions, McpServerPort, McpScope } from "../../src/core";
import { MemoryStorage } from "../fakes";

const servers: McpServerPort[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.dispose(); } });
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } } };
async function setup(scopes: McpScope[] = ["query-vault"], extra: Partial<McpServerOptions> = {}) {
  const storage = new MemoryStorage();
  const server = await createMcpServer({ storage, limits: { ...MCP_LIMITS, burst: 100, perMinute: 100 }, name: "Synthetic", version: "1", ...extra }); servers.push(server);
  const paired = await server.pair("Synthetic", scopes); await server.enable();
  const url = server.status().url!;
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${paired.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const ready = async () => {
    expect((await post(init)).status).toBe(200);
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  };
  const call = (name: string, args: unknown, id = 3) => post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return { server, storage, paired, url, post, ready, call };
}

describe("shipped local MCP adapter", () => {
  it("defaults off, stores only hashes, restarts durable grants and closes on disable", async () => {
    const storage = new MemoryStorage();
    const s = await createMcpServer({ storage, limits: MCP_LIMITS, name: "S", version: "1" }); servers.push(s);
    expect(s.status()).toEqual({ enabled: false, failed: false, url: null, clients: [] });
    const paired = await s.pair("test", []);
    const disk = JSON.stringify(await storage.readJson("mcp-grants.json"));
    expect(disk).not.toContain(paired.token); expect(JSON.stringify(s.status())).not.toContain("digest");
    await s.enable(); const old = s.status().url!; s.dispose();
    const next = await createMcpServer({ storage, limits: MCP_LIMITS, name: "S", version: "1" }); servers.push(next);
    expect(next.status().enabled).toBe(true); expect(next.status().clients[0]?.id).toBe(paired.id);
    await next.disable(); expect(next.status().url).toBeNull(); await expect(fetch(old)).rejects.toThrow();
    expect((await storage.readJson("mcp-grants.json") as { enabled: boolean }).enabled).toBe(false);
  });
  it("authenticates before parsing and rejects browser, host, proxy, path and credential tricks", async () => {
    const t = await setup();
    expect((await t.post("invalid", { Authorization: "" })).status).toBe(401);
    expect((await t.post(init, { Origin: "null" })).status).toBe(403);
    const forged = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(t.url, { method: "POST", headers: { Host: "evil.invalid", Authorization: `Bearer ${t.paired.token}` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }); req.on("error", reject); req.end("{}");
    }); expect(forged).toBe(403);
    expect((await t.post(init, { "X-Forwarded-Host": "127.0.0.1" })).status).toBe(403);
    expect((await fetch(`${t.url}?token=${t.paired.token}`, { method: "POST" })).status).toBe(401);
    expect((await fetch(t.url, { headers: { Authorization: `Bearer ${t.paired.token}` } })).status).toBe(405);
    const duplicate = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(t.url, { method: "POST", headers: ["Host", new URL(t.url).host, "Authorization", `Bearer ${t.paired.token}`, "Authorization", `Bearer ${t.paired.token}`] }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }); req.on("error", reject); req.end("{}");
    }); expect(duplicate).toBe(403);
  });
  it("negotiates JSON-only initialization, notifications and scope-filtered tools", async () => {
    const t = await setup(["submit-research"]);
    const response = await t.post(init, { "MCP-Protocol-Version": "2025-11-25" });
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect((await response.json()).result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: {} } });
    await t.ready();
    const listed = await (await t.post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(listed.result.tools.map((v: { name: string }) => v.name)).toEqual(["submit_research"]);
    expect((await (await t.call("query_vault", { question: "secret" })).json()).result).toEqual({ isError: true, content: [{ type: "text", text: "Request unavailable" }] });
    expect((await (await t.call("submit_research", { idempotencyKey: "abcdefghijklmnop", text: "synthetic" })).json()).result).toEqual({ structuredContent: { status: "unavailable" }, content: [{ type: "text", text: '{"status":"unavailable"}' }] });
  });
  it("rejects malformed envelopes, batches, unsafe IDs, versions and unknown methods", async () => {
    const t = await setup(); await t.ready();
    expect((await (await t.post("{")).json()).error.code).toBe(-32700);
    for (const raw of [[init], { ...init, id: null }, { ...init, id: 1e20 }, { ...init, path: "private.md" }]) {
      expect((await (await t.post(raw)).json()).error.code).toBe(-32600);
    }
    expect((await t.post(init, { "MCP-Protocol-Version": "bad" })).status).toBe(400);
    expect((await t.post(init, { Accept: "application/json" })).status).toBe(406);
    expect((await t.post(init, { "Content-Encoding": "gzip" })).status).toBe(415);
    expect((await (await t.post({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json()).error.code).toBe(-32601);
    expect((await (await t.call("query_vault", { question: "ok", approval: true })).json()).error.code).toBe(-32602);
    expect((await (await t.call("query_vault", { question: " " })).json()).error.code).toBe(-32602);
  });
  it.each([
    { url: "http://example.invalid" }, { url: "https://u:p@example.invalid" },
    { url: "https://example.invalid/#secret" }, { url: "https://example.invalid/#" }, { url: "https://@example.invalid" }, { url: "https://example.invalid", accessedOn: "2026-02-30" },
  ])("refuses unsafe source provenance %j", async (source) => {
    const t = await setup(["submit-research"]); await t.ready();
    expect((await (await t.call("submit_research", { idempotencyKey: "abcdefghijklmnop", text: "synthetic", sources: [source] })).json()).error.code).toBe(-32602);
  });
  it("enforces byte, rate, header and client bounds", async () => {
    const t = await setup([], { limits: { ...MCP_LIMITS, burst: 3, clients: 1 } });
    expect((await t.post("x".repeat(MCP_LIMITS.bodyBytes + 1))).status).toBe(413);
    expect((await t.post(init, { "X-Large": "x".repeat(MCP_LIMITS.headerBytes + 1) })).status).toBe(431);
    await expect(t.server.pair("second", [])).rejects.toThrow();
    await t.post(init); await t.post(init); expect((await t.post(init)).status).toBe(429);
  });
  it("enforces Unicode, metadata and global semantic concurrency bounds", async () => {
    let release!: () => void;
    const invoke = vi.fn(async () => { await new Promise<void>((r) => { release = r; }); return { status: "unavailable" as const }; });
    const t = await setup(["query-vault"], { invoke, limits: { ...MCP_LIMITS, concurrency: 1, burst: 100 } });
    const second = await t.server.pair("second", ["query-vault"]);
    const auth = { Authorization: `Bearer ${second.token}` };
    await t.post(init, auth); await t.post({ jsonrpc: "2.0", method: "notifications/initialized" }, auth);
    await t.ready();
    expect((await (await t.call("query_vault", { question: "😀".repeat(4001) })).json()).error.code).toBe(-32602);
    expect((await (await t.post({ jsonrpc: "2.0", id: 6, method: "ping", params: { _meta: { text: "x".repeat(MCP_LIMITS.metaBytes) } } })).json()).error.code).toBe(-32602);
    const pending = t.call("query_vault", { question: "😀".repeat(4000) });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const overflow = await t.post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "query_vault", arguments: { question: "second" } } }, auth);
    expect(overflow.status).toBe(429); release(); expect((await pending).status).toBe(200);
  });
  it("limits unauthenticated traffic and closes slow request bodies", async () => {
    const t = await setup([], { limits: { ...MCP_LIMITS, unauthPerMinute: 2, ioMs: 100 } });
    expect((await t.post(init, { Authorization: "wrong" })).status).toBe(401);
    expect((await t.post(init, { Authorization: "wrong" })).status).toBe(401);
    expect((await t.post(init, { Authorization: "wrong" })).status).toBe(429);
    const outcome = await new Promise<number | "closed">((resolve, reject) => {
      const req = httpRequest(t.url, { method: "POST", headers: { Authorization: `Bearer ${t.paired.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json", "Content-Length": "100" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); });
      req.on("error", () => resolve("closed")); req.setTimeout(2000, () => { req.destroy(); reject(new Error("Body timeout not enforced")); }); req.write("{");
    }); expect([408, "closed"]).toContain(outcome);
  });
  it("fails closed for malformed storage and persistence failure", async () => {
    const storage = new MemoryStorage(); await storage.writeJson("mcp-grants.json", { enabled: true, grants: [{}] });
    const bad = await createMcpServer({ storage, limits: MCP_LIMITS, name: "S", version: "1" }); servers.push(bad);
    expect(bad.status()).toMatchObject({ failed: true, enabled: false, url: null });
    await expect(bad.enable()).rejects.toThrow();
    const t = await setup();
    vi.spyOn(t.storage, "writeJson").mockRejectedValue(new Error("sensitive detail"));
    await expect(t.server.revoke(t.paired.id)).rejects.toThrow("MCP storage unavailable");
    expect(t.server.status()).toMatchObject({ failed: true, enabled: false, url: null });
    await expect(fetch(t.url)).rejects.toThrow();
  });
  it("revokes immediately, suppresses late results, and clears initialization on invalidation", async () => {
    let release!: () => void; let signal: AbortSignal | undefined;
    const invoke = vi.fn(async (_g, _n, _a, s: AbortSignal) => { signal = s; await new Promise<void>((resolve) => { release = resolve; }); return { status: "unavailable" as const }; });
    const t = await setup(["query-vault"], { invoke }); await t.ready();
    const pending = t.call("query_vault", { question: "synthetic" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    const duplicate = await t.call("query_vault", { question: "synthetic" }); expect((await duplicate.json()).error.code).toBe(-32600);
    await t.server.revoke(t.paired.id); expect(signal?.aborted).toBe(true); release();
    expect((await pending).status).toBe(409); expect((await t.post(init)).status).toBe(401);
    expect(t.server.status().clients).toEqual([]);
  });
  it("cancels active requests and bounds deadlines even for noncooperative work", async () => {
    const invoke = vi.fn(() => new Promise<{ status: "unavailable" }>(() => {}));
    const t = await setup(["query-vault"], { invoke, limits: { ...MCP_LIMITS, burst: 100, workMs: 150 } }); await t.ready();
    const pending = t.call("query_vault", { question: "synthetic" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect((await t.post({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 3 } })).status).toBe(202);
    expect((await pending).status).toBe(409);
    expect((await t.call("query_vault", { question: "synthetic" }, 4)).status).toBe(409);
    t.server.invalidate();
    expect((await (await t.call("query_vault", { question: "synthetic" })).json()).error.code).toBe(-32600);
  });
});
