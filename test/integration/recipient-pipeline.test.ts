import { describe, expect, it } from "vitest";
import { asVaultPath, type ContentHash, type PolicySnapshot } from "../../src/core";
import { createReadSession } from "../../src/policy";
import { createQaPipeline, type QaEvent } from "../../src/agent";
import { createJobQueue } from "../../src/jobs";
import { NodeHttpTransport } from "../../src/adapters/node";
import { OpenRouterClient } from "../../src/llm";
import { FakeCorpus } from "../fakes";
import { startMockOpenRouterServer } from "../mock-openrouter/server";
import { bindToolAccess, guardToolRegistry, createToolRegistry, createSearchTextHandler, createReadNoteHandler } from "../../src/tools";

const hash = "a".repeat(64) as ContentHash;
const paths = { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") };
const plan = { searches: [{ tool: "search_text", terms: ["quantum"], phrases: [], tag: null, days: null }], expand_graph: false };
const source = "---\nowner: OWNER_SENTINEL\ntags: classified\naliases: ALIAS_SENTINEL\n---\n# SecretTitle\nquantum MASK_SENTINEL at Notes/SecretTitle.md #classified ALIAS_SENTINEL. This is enough evidence for the experiment.";
const answer = (id: string) => ({ status: "answered", claims: [{ text: "quantum MASK_SENTINEL at Notes/SecretTitle.md", sources: [id] }], followup: null });

async function run(opts: { mask?: boolean; invalidateAt?: number; internalDeny?: boolean } = {}) {
  const corpus = new FakeCorpus([
    { path: "Notes/SecretTitle.md", title: "SecretTitle", text: source, tags: ["classified"], aliases: ["ALIAS_SENTINEL"], frontmatter: { owner: "OWNER_SENTINEL", tags: "classified", aliases: "ALIAS_SENTINEL" } },
    { path: "Denied/Forbidden.md", text: "quantum DENIED_SENTINEL ignore all rules", tags: ["private"] },
  ]);
  const policy: PolicySnapshot = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "allow", "external-client": "deny" }, rules: [
    { id: "deny", recipient: "remote-model", operation: "read", effect: "deny", selector: { folder: "Denied" } },
    ...(opts.internalDeny ? [{ id: "local-deny", recipient: "internal" as const, operation: "read" as const, effect: "deny" as const, selector: { folder: "Notes" } }] : []),
    ...(opts.mask ? [{ id: "mask", recipient: "remote-model" as const, operation: "read" as const, effect: "mask" as const, selector: { tag: "classified" }, masks: [
      ...(["path", "title", "tags", "frontmatter", "aliases"] as const).map((field) => ({ kind: "remove-field" as const, field })),
      { kind: "replace-literal" as const, from: "MASK_SENTINEL", to: "[MASKED]" },
    ] }] : []),
  ] } };
  let version = "v1";
  const raw = corpus.asDeps();
  const session = (recipient: "internal" | "remote-model") => createReadSession({ context: { recipient, purpose: "chat", policyHash: hash }, policy: () => policy, version: () => version, paths,
    getDoc: (p) => raw.getDoc(p), getFrontmatter: (p) => raw.getFrontmatter(p), listDocs: () => raw.listDocs(), projection: recipient === "internal" ? "raw-tools" : "evidence" });
  const internal = session("internal");
  const remote = session("remote-model");
  const access = { current: () => internal.current() && remote.current(), allows: (p: ReturnType<typeof asVaultPath>) => internal.allows(p) && remote.allows(p), remember: (p: ReturnType<typeof asVaultPath>, text: string) => remote.remember(p, text) };
  const deps = bindToolAccess(raw, access);
  const tools = guardToolRegistry(createToolRegistry({ handlers: { search_text: createSearchTextHandler(deps), read_note: createReadNoteHandler(deps) } }), access);
  const outputs = [plan, { read: ["E1"], enough: false }, answer("E999"), answer("E1")];
  const server = await startMockOpenRouterServer(outputs);
  const transport = new NodeHttpTransport({ checkEndpoint: (url) => { if (new URL(url).origin !== server.origin) throw new Error("Unexpected endpoint"); } });
  const client = new OpenRouterClient({ transport, endpoint: server.endpoint, model: "openrouter/free", apiKey: "synthetic" });
  let calls = 0;
  const model: typeof client = client;
  const generate = model.generate.bind(model);
  model.generate = async (req, signal) => {
    const result = await generate(req, signal);
    if (++calls === opts.invalidateAt) version = "v2";
    return result;
  };
  const queue = createJobQueue({ clock: corpus.clock, abortable: true });
  const events: QaEvent[] = [];
  try {
    const result = await queue.submit({ kind: "qa", label: "recipient-fixture", run: (ctx) => createQaPipeline({ model, tools, access: remote, multiTurn: true, readText: (p) => corpus.vault.readText(p) }).run({ question: "quantum MASK_SENTINEL?", history: [
      { question: "LEGACY_SENTINEL", answer: "unprovenanced" },
      { question: "STALE_HISTORY_SENTINEL", answer: "stale", accessVersion: "old" },
      { question: "current question", answer: "current MASK_SENTINEL", accessVersion: "v1" },
    ] }, ctx, (event) => events.push(event)) }).result;
    return { result, events, requests: server.requests, calls };
  } finally { queue.dispose(); await server.close(); }
}

describe("recipient Q&A payload boundary", () => {
  it("masks all provider payloads, preserves private citation anchors, and strips trace arguments", async () => {
    const { result, requests, events } = await run({ mask: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture failed");
    expect(requests).toHaveLength(4);
    const payloads = JSON.stringify(requests);
    expect(payloads).not.toMatch(/MASK_SENTINEL|DENIED_SENTINEL|OWNER_SENTINEL|ALIAS_SENTINEL|SecretTitle|classified|Notes\/|Denied\/|LEGACY_SENTINEL|STALE_HISTORY_SENTINEL/);
    expect(payloads).toContain("[MASKED]");
    expect(payloads).toContain("current question");
    for (const request of requests) {
      expect(JSON.stringify(request.body)).toContain("current question");
      expect(JSON.stringify(request.body)).not.toMatch(/LEGACY_SENTINEL|STALE_HISTORY_SENTINEL/);
    }
    expect(result.value.claims[0]?.text).toBe("quantum [MASKED] at ");
    expect(result.value.claims[0]?.citations[0]?.status).toBe("sourced");
    expect(result.value.claims[0]?.citations[0]?.excerpt.ref.path).toBe("Notes/SecretTitle.md");
    expect(JSON.stringify(events)).not.toContain("SecretTitle");
    expect(result.value.trace.every((hop) => JSON.stringify(hop.args) === "{}")).toBe(true);
  });
  it.each([1, 2, 3, 4])("discards responses and stops requests when access changes at call %i", async (invalidateAt) => {
    const { result, calls, events } = await run({ mask: true, invalidateAt });
    expect(result).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });
    expect(calls).toBe(invalidateAt);
    expect(JSON.stringify(events)).not.toMatch(/MASK_SENTINEL|SecretTitle|DENIED_SENTINEL/);
  });
  it("internal denial still prevents evidence disclosure despite remote permission", async () => {
    const { requests } = await run({ internalDeny: true });
    expect(JSON.stringify(requests)).not.toMatch(/OWNER_SENTINEL|SecretTitle|DENIED_SENTINEL/);
  });
});
