import { z } from "zod";
import { contentHash, stableStringify, type ActiveNotePort, type ControlPaths, type InstructionSnapshot, type McpGrant, type McpResult, type MetadataPort, type PolicySnapshot, type ResearchAppendPort, type StoragePort, type VaultPort } from "../core";
import { COLLABORATION_LIMITS as L } from "../constants";
import { evaluateAccessContract, type AccessRuntime, type ExclusionPolicy } from "../policy";
import type { JobQueue } from "../jobs";
import type { ModelPort } from "../llm";
import type { CoreToolDeps, ToolRegistry, ToolReadAccess } from "../tools";
import { query } from "./query";

export type Client = Readonly<Omit<McpGrant, "digest">>;
export interface CollaborationEnvironment {
  vault: VaultPort; metadata: MetadataPort; activeNote: ActiveNotePort;
  paths: ControlPaths; policy: PolicySnapshot; instructions: InstructionSnapshot;
  access: AccessRuntime; exclusion: ExclusionPolicy; jobs: JobQueue; model: ModelPort;
  tools: CoreToolDeps;
  registry(access: ToolReadAccess): ToolRegistry;
  appender(gate: { current(): boolean; revalidate(): Promise<boolean>; editorSnapshots(): readonly { path: string; text: string }[] }): ResearchAppendPort;
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.strictObject({ client: z.string().min(1).max(128), key: hashSchema, payload: hashSchema,
  receipt: z.string().regex(/^[A-Za-z0-9_-]{22}$/), at: z.number().int().nonnegative(),
  path: z.string().min(1).max(1024), before: hashSchema, after: hashSchema, append: hashSchema,
  status: z.enum(["intent", "accepted"]),
});
type Receipt = z.infer<typeof recordSchema>;
const journalSchema = z.strictObject({ version: z.literal(1), records: z.array(recordSchema).max(L.receipts) });
const unavailable = (): McpResult => ({ status: "unavailable" });
export async function digest(text: string): Promise<string> {
  const hash = await contentHash(text); if (!hash.ok) throw new Error("Collaboration unavailable"); return hash.value;
}

/** One service owns the serialized journal for the entire plugin lifetime. */
export function createCollaboration(o: { storage: StoragePort; environment(): CollaborationEnvironment | null; id(): string; now(): number }) {
  let tail: Promise<unknown> = Promise.resolve();
  let poisoned = false;
  async function submit(e: CollaborationEnvironment, client: Client, args: { idempotencyKey: string; text: string; sources?: { url: string; accessedOn?: string }[] }, signal: AbortSignal): Promise<McpResult> {
    const version = e.access.version();
    const current = () => !signal.aborted && o.environment()?.access === e.access && e.access.version() === version;
    let editors: { path: string; text: string }[] = [];
    const validate = async () => {
      if (!current() || !await controlsCurrent(e)) return false;
      editors = await Promise.all([e.paths.instructions].map(async (path) => ({ path, text: await e.vault.readText(path) })));
      if (!await controlsCurrent(e)) return false;
      const meta = e.metadata.get(e.paths.research);
      return current() && evaluateAccessContract(e.policy, {
        context: { recipient: "external-client", purpose: "submit", policyHash: e.policy.hash, clientId: client.id, capabilities: client.scopes },
        operation: "append-research", path: e.paths.research, controlPaths: e.paths,
        tags: meta?.tags ?? null, frontmatter: meta?.frontmatter ?? null,
        excluded: e.exclusion.decide(e.paths.research, meta?.tags ?? null, meta?.frontmatter ?? null) === "excluded", maskingSupported: false,
      }).effect === "allow";
    };
    if (poisoned || !await validate()) return unavailable();
    const raw = await o.storage.readJson("mcp-receipts.json");
    const parsed = journalSchema.safeParse(raw ?? { version: 1, records: [] });
    if (!parsed.success) { poisoned = true; return unavailable(); }
    const records = parsed.data.records.filter((r) => r.status === "intent" || o.now() - r.at < L.retentionMs);
    if (new Set(records.map((r) => `${r.client}:${r.key}`)).size !== records.length) { poisoned = true; return unavailable(); }
    const key = await digest(args.idempotencyKey);
    const payload = await digest(stableStringify({ text: args.text.replace(/\r\n?/g, "\n"), sources: args.sources ?? [] }));
    const existing = records.find((r) => r.client === client.id && r.key === key);
    if (existing) {
      if (existing.payload !== payload) return current() ? { status: "conflict" } : unavailable();
      if (existing.status === "intent") {
        if (existing.path !== e.paths.research) return unavailable();
        const text = await e.vault.readText(e.paths.research);
        const start = `\n\n<!-- synapse-mcp:${existing.receipt}:start -->\n`;
        const end = `\n<!-- synapse-mcp:${existing.receipt}:end -->\n`;
        const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
        if (from < 0 || to < 0 || text.indexOf(start, from + 1) >= 0 || await digest(text.slice(from, to + end.length)) !== existing.append) return unavailable();
        if (await digest(text.slice(0, from)) !== existing.before || await digest(text.slice(0, to + end.length)) !== existing.after) return unavailable();
        existing.status = "accepted";
        await save(records);
      }
      return await validate() ? { status: "accepted", receipt: existing.receipt } : unavailable();
    }
    if (records.length >= L.receipts) return unavailable();
    const before = await e.vault.readText(e.paths.research);
    const receipt = o.id();
    if (!/^[A-Za-z0-9_-]{22}$/.test(receipt)) return unavailable();
    // Client text stays on one quoted JSON line: it cannot forge marker/provenance lines.
    const quote = (value: unknown) => JSON.stringify(value).replace(/[<>&`]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
    const append = `\n\n<!-- synapse-mcp:${receipt}:start -->\nExternal unverified research\nClient: ${quote(client.id)}\nReceived (UTC): ${new Date(o.now()).toISOString()}\n\n> ${quote(args.text.replace(/\r\n?/g, "\n"))}\n\nSources (unverified, never fetched): ${quote(args.sources ?? [])}\n<!-- synapse-mcp:${receipt}:end -->\n`;
    const record: Receipt = { client: client.id, key, payload, receipt, at: o.now(), path: e.paths.research,
      before: await digest(before), after: await digest(before + append), append: await digest(append), status: "intent" };
    records.push(record);
    await save(records); // Durable intent before crossing the write port.
    if (!await validate()) return unavailable();
    const result = await e.appender({ current, revalidate: validate, editorSnapshots: () => editors }).append({ before, text: append, signal });
    if (!result.ok) return unavailable(); // Retain uncertain intent; never automatically replay.
    record.status = "accepted";
    await save(records);
    // The inbox's own write invalidates source versions. Authorization before commit
    // is atomic in the adapter; transport independently rechecks grants before delivery.
    return !signal.aborted && o.environment()?.access === e.access ? { status: "accepted", receipt } : unavailable();
  }
  async function save(records: Receipt[]) {
    try { await o.storage.writeJson("mcp-receipts.json", { version: 1, records }); }
    catch { poisoned = true; throw new Error("Collaboration unavailable"); }
  }
  return {
    async invoke(client: Client, name: string, args: unknown, signal: AbortSignal): Promise<McpResult> {
      try {
        const e = o.environment(); if (!e || signal.aborted) return unavailable();
        if (name === "query_vault" && client.scopes.includes("query-vault")) return await query(e, client, args as { question: string }, signal, () => o.id());
        if (name !== "submit_research" || !client.scopes.includes("submit-research")) return unavailable();
        const work = tail.then(() => submit(e, client, args as Parameters<typeof submit>[2], signal));
        tail = work.catch(() => {});
        return await work;
      } catch { return unavailable(); }
    },
  };
}

/** Exact disk checks supplement synchronous host-event invalidation. */
export async function controlsCurrent(e: CollaborationEnvironment): Promise<boolean> {
  const files = await e.vault.listFiles();
  for (const [path, expected] of [[e.paths.instructions, e.instructions.hash]] as const) {
    const matches = files.filter((f) => f.path.toLowerCase() === path.toLowerCase());
    if (matches.length !== 1 || matches[0].path !== path) return false;
    const text = await e.vault.readText(path);
    const editor = e.activeNote.current();
    if (await digest(text) !== expected || (editor?.path === path && editor.text !== text)) return false;
  }
  return true;
}
