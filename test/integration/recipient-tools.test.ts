import { describe, expect, it } from "vitest";
import { asVaultPath, type AccessRecipient, type ContentHash, type PolicySnapshot } from "../../src/core";
import { createReadSession } from "../../src/policy";
import { FakeCorpus } from "../fakes";
import {
  bindToolAccess, guardToolRegistry, createToolRegistry, createSearchTextHandler,
  createSearchByTitleHandler, createSearchByTagHandler, createReadNoteHandler,
  createGetLinksHandler, createGetBacklinksHandler, createGetFrontmatterHandler,
  createListRecentHandler, type ToolName,
} from "../../src/tools";

const paths = { instructions: asVaultPath("Synapse/Instructions.md"), research: asVaultPath("Research.md") };
const hash = "a".repeat(64) as ContentHash;
function fixture(recipient: AccessRecipient = "internal", mode: "deny" | "mask" = "deny") {
  const corpus = new FakeCorpus([
    { path: "A/Denied.md", text: "keyword FORBIDDEN_99", tags: ["work"], frontmatter: { visibility: "private" } },
    { path: "Z/Allowed.md", text: "keyword allowed", tags: ["work"], frontmatter: { visibility: "public" } },
  ], { resolvedLinks: { "A/Denied.md": { "Z/Allowed.md": 1 }, "Z/Allowed.md": { "A/Denied.md": 1, "Missing.md": 1 } } });
  let version = "v1";
  const policy: PolicySnapshot = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "allow", "external-client": "allow" }, rules: [
    { id: "block", recipient, operation: "read", effect: mode, selector: { frontmatter: { key: "visibility", value: "private" } }, ...(mode === "mask" ? { masks: [{ kind: "remove-field" as const, field: "path" as const }] } : {}) },
  ] } };
  const raw = corpus.asDeps();
  const context = recipient === "external-client" ? { recipient, purpose: "query", policyHash: hash, clientId: "paired", capabilities: ["query-vault"] } as const : { recipient, purpose: "chat", policyHash: hash } as const;
  const session = createReadSession({ context, projection: "raw-tools", version: () => version, policy: () => policy, paths, getDoc: (path) => raw.getDoc(path), getFrontmatter: (path) => raw.getFrontmatter(path), listDocs: () => raw.listDocs() });
  const deps = bindToolAccess(raw, session);
  const tools = guardToolRegistry(createToolRegistry({ handlers: {
    search_text: createSearchTextHandler(deps), search_by_title: createSearchByTitleHandler(deps),
    search_by_tag: createSearchByTagHandler(deps), read_note: createReadNoteHandler(deps),
    get_links: createGetLinksHandler(deps), get_backlinks: createGetBacklinksHandler(deps),
    get_frontmatter: createGetFrontmatterHandler(deps), list_recent: createListRecentHandler(deps),
  } }), session);
  return { tools, corpus, raw, session, change: () => { version = "v2"; } };
}
const requests: [ToolName, unknown][] = [
  ["search_text", { terms: ["keyword"], limit: 1 }], ["search_by_title", { query: "ed", limit: 1 }],
  ["search_by_tag", { tag: "work", limit: 1 }], ["list_recent", { by: "mtime", days: 30, limit: 1 }],
  ["read_note", { path: "Z/Allowed.md" }], ["get_frontmatter", { paths: ["Z/Allowed.md"] }],
  ["get_links", { paths: ["Z/Allowed.md"] }], ["get_backlinks", { paths: ["Z/Allowed.md"] }],
];
const invoke = (tools: ReturnType<typeof fixture>["tools"], name: ToolName, args: unknown) => tools.invoke(name, args, { signal: new AbortController().signal });

describe.each(["internal", "remote-model", "external-client"] as const)("access-bound tools for %s", (recipient) => {
  it.each(requests)("filters %s before limits and returns no forbidden metadata", async (name, args) => {
    const { tools } = fixture(recipient);
    const result = await invoke(tools, name, args);
    expect(result.ok).toBe(true);
    const visible = JSON.stringify(result);
    expect(visible).not.toMatch(/Denied|FORBIDDEN_99|private|Missing/);
    if (name === "get_links") expect(result).toMatchObject({ data: { results: [{ outgoing: [], unresolvedCount: 0 }] } });
    else if (name === "get_backlinks") expect(result).toMatchObject({ data: { results: [{ incoming: [] }] } });
    else expect(visible).toContain("Allowed.md");
  });
  it.each(["read_note", "get_frontmatter", "get_links", "get_backlinks"] as const)("makes denied and missing %s indistinguishable", async (name) => {
    const { tools } = fixture(recipient);
    const args = (path: string) => name === "read_note" ? { path } : { paths: [path] };
    expect(await invoke(tools, name, args("A/Denied.md"))).toEqual(await invoke(tools, name, args("Absent.md")));
  });
  it.each(requests)("denies unsupported raw masks for %s", async (name, args) => {
    const { tools } = fixture(recipient, "mask");
    expect(JSON.stringify(await invoke(tools, name, args))).not.toMatch(/Denied|FORBIDDEN_99/);
  });
});

it("rejects a result that becomes stale inside an asynchronous read", async () => {
  const f = fixture();
  const read = f.raw.readText.bind(f.raw);
  f.raw.readText = async (path) => { const text = await read(path); f.change(); return text; };
  expect(await invoke(f.tools, "read_note", { path: "Z/Allowed.md" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
});
it("returns empty search results when only denied or absent matches exist", async () => {
  const { tools } = fixture();
  for (const [name, args] of [["search_text", { terms: ["FORBIDDEN_99"] }], ["search_by_title", { query: "Denied" }], ["search_by_tag", { tag: "absent" }]] as const) {
    const result = await invoke(tools, name, args);
    expect(result).toMatchObject({ ok: true, truncated: false });
    expect(JSON.stringify(result)).not.toMatch(/Denied|FORBIDDEN_99|Allowed/);
  }
});
