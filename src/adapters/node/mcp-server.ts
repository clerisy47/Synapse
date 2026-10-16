/** The sole allowlisted inbound network adapter. Never performs outbound I/O. */
import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import type { McpGrant, McpServerOptions, McpServerPort } from "../../core";
import { MCP_VERSION, createMcpProtocol, unavailable } from "./mcp-protocol";
const STORE = "mcp-grants.json";
const scopesAllowed = new Set(["query-vault", "submit-research"]);
const digest = (token: string) => createHash("sha256").update(token).digest();
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function validGrants(raw: unknown, max: number, labelMax: number): raw is {
    enabled: boolean;
    grants: McpGrant[];
} {
    if (!object(raw) || Object.keys(raw).sort().join() !== "enabled,grants" || typeof raw.enabled !== "boolean" || !Array.isArray(raw.grants) || raw.grants.length > max)
        return false;
    const ids = new Set<string>();
    const hashes = new Set<string>();
    return raw.grants.every((g: unknown) => {
        if (!object(g) || Object.keys(g).sort().join() !== "digest,generation,id,label,scopes" || typeof g.id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(g.id) || ids.has(g.id) || typeof g.digest !== "string" || !/^[a-f0-9]{64}$/.test(g.digest) || hashes.has(g.digest) || typeof g.label !== "string" || !g.label.trim() || [...g.label].length > labelMax || !Number.isSafeInteger(g.generation) || Number(g.generation) < 0 || !Array.isArray(g.scopes) || g.scopes.length > 2 || new Set(g.scopes).size !== g.scopes.length || !g.scopes.every((s: unknown) => typeof s === "string" && scopesAllowed.has(s)))
            return false;
        ids.add(g.id);
        hashes.add(g.digest);
        return true;
    });
}
export async function createMcpServer(o: McpServerOptions): Promise<McpServerPort> {
    const l = o.limits;
    const { tools, envelope, initialize, toolCall, emptyParams, validArguments } = createMcpProtocol(l);
    let grants: McpGrant[] = [];
    let enabled = false;
    let failed = false;
    let disposed = false;
    let server: Server | null = null;
    let url: string | null = null;
    let epoch = 0;
    let mutations = Promise.resolve();
    let unauth = { start: Date.now(), count: 0 };
    const initialized = new Set<string>();
    const ready = new Set<string>();
    const active = new Map<string, {
        abort: AbortController;
        id: string | number;
    }>();
    const busy = new Set<string>();
    const rates = new Map<string, {
        tokens: number;
        at: number;
    }>();
    const invalidate = () => { epoch++; initialized.clear(); ready.clear(); for (const a of active.values())
        a.abort.abort(); };
    const stop = async () => {
        invalidate();
        url = null;
        const s = server;
        server = null;
        if (s)
            await new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); });
    };
    const persist = async () => {
        try {
            await o.storage.writeJson(STORE, { enabled, grants });
        }
        catch {
            failed = true;
            enabled = false;
            await stop();
            throw new Error("MCP storage unavailable");
        }
    };
    const serial = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = mutations.then(async () => { if (disposed)
            throw new Error("MCP closed"); return fn(); });
        mutations = next.then(() => undefined, () => undefined);
        return next;
    };
    const http = (res: ServerResponse, status: number) => { res.writeHead(status, { "Connection": "close" }); res.end(); };
    const rpc = (res: ServerResponse, id: string | number | null, result: unknown, code?: number) => {
        if (res.destroyed || res.writableEnded)
            return;
        let body = JSON.stringify(code ? { jsonrpc: "2.0", id, error: { code, message: "Request rejected" } } : { jsonrpc: "2.0", id, result });
        if (Buffer.byteLength(body) > l.outputBytes)
            body = JSON.stringify({ jsonrpc: "2.0", id, result: unavailable() });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(body);
    };
    const acceptRate = (id: string) => {
        const now = Date.now();
        const r = rates.get(id) ?? { tokens: l.burst, at: now };
        r.tokens = Math.min(l.burst, r.tokens + (now - r.at) * l.perMinute / 60000);
        r.at = now;
        rates.set(id, r);
        if (r.tokens < 1)
            return false;
        r.tokens--;
        return true;
    };
    const handle = async (req: IncomingMessage, res: ServerResponse) => {
        const counts = new Map<string, number>();
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            const k = req.rawHeaders[i].toLowerCase();
            counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        if (req.headers.origin !== undefined || req.headers.host !== url?.slice(7, -4) || [...counts].some(([k, n]) => n > 1 && ["host", "authorization", "mcp-protocol-version", "content-type"].includes(k)) || [...counts.keys()].some((k) => k === "forwarded" || k.startsWith("x-forwarded-")))
            return http(res, 403);
        const header = req.headers.authorization ?? "";
        const given = digest(header.startsWith("Bearer ") ? header.slice(7) : "");
        // Every grant is compared, even after a match.
        let grant: McpGrant | undefined;
        for (const g of grants)
            if (timingSafeEqual(given, Buffer.from(g.digest, "hex")) && header.startsWith("Bearer "))
                grant = g;
        if (!grant || failed || !enabled || disposed) {
            if (Date.now() - unauth.start >= 60000)
                unauth = { start: Date.now(), count: 0 };
            return http(res, ++unauth.count > l.unauthPerMinute ? 429 : 401);
        }
        if (!acceptRate(grant.id))
            return http(res, 429);
        if (req.url !== "/mcp")
            return http(res, 404);
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return http(res, 405);
        }
        if (req.headers["content-encoding"] !== undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? ""))
            return http(res, 415);
        const accept = (req.headers.accept ?? "").split(",").map((s) => s.trim());
        if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
            return http(res, 406);
        if (req.headers["mcp-protocol-version"] !== undefined && req.headers["mcp-protocol-version"] !== MCP_VERSION)
            return http(res, 400);
        if (busy.has(grant.id) || busy.size >= l.concurrency)
            return http(res, 429);
        busy.add(grant.id);
        const started = Date.now();
        const captured = epoch;
        const generation = grant.generation;
        const current = () => !disposed && enabled && !failed && captured === epoch && grants.some((g) => g.id === grant.id && g.generation === generation);
        const abort = new AbortController();
        const disconnect = () => abort.abort();
        res.on("close", disconnect);
        const timer = setTimeout(() => { abort.abort(); http(res, 408); }, l.ioMs);
        try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
                size += Buffer.byteLength(chunk as Buffer);
                if (size > l.bodyBytes) {
                    http(res, 413);
                    return;
                }
                chunks.push(Buffer.from(chunk as Buffer));
            }
            clearTimeout(timer);
            req.socket.setTimeout(0);
            busy.delete(grant.id);
            if (!current() || abort.signal.aborted)
                return http(res, 401);
            let raw: unknown;
            try {
                raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
            }
            catch {
                return rpc(res, null, null, -32700);
            }
            const parsed = envelope.safeParse(raw);
            if (!parsed.success)
                return rpc(res, null, null, -32600);
            const { id, method, params } = parsed.data;
            if (params?._meta !== undefined && Buffer.byteLength(JSON.stringify(params._meta)) > l.metaBytes)
                return rpc(res, id ?? null, null, -32602);
            if (method !== "initialize" && req.headers["mcp-protocol-version"] !== MCP_VERSION)
                return http(res, 400);
            if (id === undefined) {
                if (method === "notifications/initialized" && initialized.has(grant.id) && emptyParams.safeParse(params ?? {}).success) {
                    ready.add(grant.id);
                    return http(res, 202);
                }
                if (method === "notifications/cancelled" && object(params) && (typeof params.requestId === "string" || typeof params.requestId === "number")) {
                    const a = active.get(grant.id);
                    if (a?.id === params.requestId)
                        a.abort.abort();
                    return http(res, 202);
                }
                return http(res, 400);
            }
            if (active.has(grant.id))
                return rpc(res, id, null, -32600);
            if (method === "initialize") {
                if (!initialize.safeParse(params).success)
                    return rpc(res, id, null, -32602);
                initialized.add(grant.id);
                ready.delete(grant.id);
                return rpc(res, id, { protocolVersion: MCP_VERSION, capabilities: { tools: {} }, serverInfo: { name: o.name, version: o.version } });
            }
            if (method === "ping")
                return emptyParams.safeParse(params ?? {}).success ? rpc(res, id, {}) : rpc(res, id, null, -32602);
            if (!ready.has(grant.id))
                return rpc(res, id, null, -32600);
            if (method === "tools/list") {
                if (!emptyParams.safeParse(params ?? {}).success)
                    return rpc(res, id, null, -32602);
                return rpc(res, id, { tools: tools.filter((t) => grant.scopes.includes(t.scope)).map(({ name, inputSchema }) => ({ name, inputSchema })) });
            }
            if (method !== "tools/call")
                return rpc(res, id, null, -32601);
            const call = toolCall.safeParse(params);
            if (!call.success)
                return rpc(res, id, null, -32602);
            const tool = tools.find((t) => t.name === call.data.name && grant.scopes.includes(t.scope));
            if (!tool)
                return rpc(res, id, { isError: true, content: [{ type: "text", text: "Request unavailable" }] });
            if (!validArguments(tool.name, call.data.arguments))
                return rpc(res, id, null, -32602);
            if (active.size >= l.concurrency)
                return http(res, 429);
            active.set(grant.id, { abort, id });
            const deadline = setTimeout(() => abort.abort(), Math.max(0, l.workMs - (Date.now() - started)));
            try {
                const canceled = new Promise<null>((resolve) => { if (abort.signal.aborted)
                    resolve(null);
                else
                    abort.signal.addEventListener("abort", () => resolve(null), { once: true }); });
                const result = await Promise.race([o.invoke?.({ id: grant.id, label: grant.label, generation: grant.generation, scopes: [...grant.scopes] }, tool.name, call.data.arguments, abort.signal) ?? Promise.resolve(null), canceled]);
                // Authority and source invalidation can race semantic completion.
                if (!current() || abort.signal.aborted)
                    return http(res, 409);
                const safe = result ?? { status: "unavailable" };
                rpc(res, id, { structuredContent: safe, content: [{ type: "text", text: JSON.stringify(safe) }] });
            }
            finally {
                clearTimeout(deadline);
                active.delete(grant.id);
            }
        }
        finally {
            clearTimeout(timer);
            busy.delete(grant.id);
            res.off("close", disconnect);
        }
    };
    const start = async () => {
        if (server || disposed || failed)
            return;
        const s = createServer({ maxHeaderSize: l.headerBytes, headersTimeout: l.ioMs, requestTimeout: l.ioMs, connectionsCheckingInterval: l.ioMs }, (req, res) => {
            void handle(req, res).catch(() => { if (!res.headersSent)
                http(res, 400);
            else
                res.destroy(); });
        });
        server = s;
        s.maxConnections = l.concurrency + l.clients;
        s.keepAliveTimeout = l.ioMs;
        s.on("connection", (socket) => socket.setTimeout(l.ioMs, () => socket.destroy()));
        s.on("error", () => { failed = true; enabled = false; void stop(); });
        try {
            await new Promise<void>((resolve, reject) => { s.once("error", reject); s.listen(0, "127.0.0.1", () => { s.off("error", reject); resolve(); }); });
            if (disposed || !enabled) {
                await stop();
                return;
            }
            const a = s.address();
            if (!a || typeof a === "string")
                throw new Error("MCP unavailable");
            url = `http://127.0.0.1:${a.port}/mcp`;
        }
        catch {
            failed = true;
            enabled = false;
            await stop();
        }
    };
    try {
        const raw = await o.storage.readJson(STORE);
        if (raw !== null) {
            if (!validGrants(raw, l.clients, l.labelPoints))
                failed = true;
            else {
                grants = raw.grants;
                enabled = raw.enabled;
            }
        }
    }
    catch {
        failed = true;
    }
    if (enabled)
        await start();
    return {
        status: () => ({ enabled, url, failed, clients: grants.map(({ id, label, scopes, generation }) => ({ id, label, scopes: [...scopes], generation })) }),
        enable: () => serial(async () => { if (failed)
            throw new Error("MCP storage unavailable"); enabled = true; await persist(); await start(); if (failed)
            throw new Error("MCP unavailable"); }),
        disable: () => { enabled = false; const stopped = stop(); return serial(async () => { await stopped; await persist(); }); },
        pair: (label, scopes) => serial(async () => {
            if (failed || grants.length >= l.clients || !label.trim() || [...label].length > l.labelPoints || new Set(scopes).size !== scopes.length || !scopes.every((s) => scopesAllowed.has(s)))
                throw new Error("MCP pairing refused");
            const token = randomBytes(32).toString("base64url");
            const id = randomBytes(16).toString("base64url");
            grants.push({ id, label, scopes: [...scopes], digest: digest(token).toString("hex"), generation: 0 });
            await persist();
            return { id, token };
        }),
        revoke: (id) => {
            invalidate();
            grants = grants.filter((g) => g.id !== id);
            rates.delete(id);
            return serial(async () => { await persist(); });
        },
        invalidate,
        dispose: () => { disposed = true; enabled = false; void stop(); },
    };
}
