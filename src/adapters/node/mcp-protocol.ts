/** Deliberately bounded MCP 2025-11-25 JSON-only protocol surface. */
import { URL } from "node:url";
import { z } from "zod";
import type { McpLimits, McpScope } from "../../core";
export const MCP_VERSION = "2025-11-25";
const points = (max: number) => z.string().refine((s) => s.trim().length > 0 && [...s].length <= max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const n = Date.parse(s);
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s;
});
export function createMcpProtocol(l: McpLimits) {
    const source = z.strictObject({
        url: z.string().max(l.urlChars).refine((s) => {
            try {
                const u = new URL(s);
                return s === s.trim() && /^https:\/\//i.test(s) && u.protocol === "https:" && !u.username && !u.password && !s.includes("#") && !s.slice(8).split(/[/?#]/)[0].includes("@");
            }
            catch {
                return false;
            }
        }),
        accessedOn: date.optional(),
    });
    const query = z.strictObject({ question: points(l.questionPoints) });
    const submit = z.strictObject({
        idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), text: points(l.researchPoints), sources: z.array(source).max(l.sources).optional(),
    });
    const tools = [
        { name: "query_vault", scope: "query-vault" as McpScope, inputSchema: z.toJSONSchema(query) },
        { name: "submit_research", scope: "submit-research" as McpScope, inputSchema: z.toJSONSchema(submit) },
    ];
    const id = z.union([z.string().regex(/^[\x20-\x7e]{1,64}$/), z.number().int().refine(Number.isSafeInteger)]);
    const envelope = z.strictObject({
        jsonrpc: z.literal("2.0"), id: id.optional(), method: z.string().max(128),
        params: z.record(z.string(), z.unknown()).optional(),
    });
    const initialize = z.strictObject({
        protocolVersion: z.string().max(32), capabilities: z.record(z.string(), z.unknown()),
        clientInfo: z.object({ name: z.string().max(128), version: z.string().max(64) }),
        _meta: z.record(z.string(), z.unknown()).optional(),
    });
    const toolCall = z.strictObject({ name: z.string(), arguments: z.unknown(), _meta: z.record(z.string(), z.unknown()).optional() });
    const emptyParams = z.strictObject({ _meta: z.record(z.string(), z.unknown()).optional() });
    function validArguments(name: string, args: unknown): boolean {
        return (name === "query_vault" ? query : submit).safeParse(args).success;
    }
    // JSON Schema counts Unicode code points; runtime validators enforce the same bounds.
    Object.assign((tools[0].inputSchema.properties as Record<string, object>).question, { minLength: 1, maxLength: l.questionPoints });
    Object.assign((tools[1].inputSchema.properties as Record<string, object>).text, { minLength: 1, maxLength: l.researchPoints });
    return { tools, envelope, initialize, toolCall, emptyParams, validArguments };
}
export function unavailable() {
    const structuredContent = { status: "unavailable" as const };
    return { structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }] };
}
