import { afterEach, describe, expect, it } from "vitest";
import { NodeHttpTransport } from "../../src/adapters/node";
import { createQaPipeline, type QaEvent } from "../../src/agent";
import { createCorpusStore } from "../../src/corpus";
import { createJobQueue } from "../../src/jobs";
import { OpenRouterClient, SHARED_SYSTEM_PREFIX, type OpenRouterChatRequest } from "../../src/llm";
import { createExclusionPolicy } from "../../src/policy";
import {
  createGetBacklinksHandler, createGetFrontmatterHandler, createGetLinksHandler,
  createListRecentHandler, createReadNoteHandler, createSearchByTagHandler,
  createSearchByTitleHandler, createSearchTextHandler, createToolRegistry,
  type CoreToolDeps,
} from "../../src/tools";
import { FakeClock, FakeMetadata, FakeVault } from "../fakes";
import { startMockOpenRouterServer } from "../mock-openrouter/server";

const NOTE = "The quantum rendezvous takes place in Alpha. The team meets there every Thursday to discuss the project and its upcoming experiments.";
const PRIVATE = "quantum EXCLUDED_SENTINEL_73";
const plan = {
  searches: [{ tool: "search_text", terms: ["quantum"], phrases: [], tag: null, days: null }],
  expand_graph: false,
};
const answer = (sources: string[]) => ({
  status: "answered", claims: [{ text: "The rendezvous is in Alpha.", sources }], followup: null,
});
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function run(outputs: unknown[]) {
  const server = await startMockOpenRouterServer(outputs);
  cleanup.push(server.close);
  const clock = new FakeClock(1_700_000_000_000);
  const vault = new FakeVault();
  const metadata = new FakeMetadata();
  for (const path of ["notes/alpha.md", "private/secret.md"]) {
    vault.addNote({ path, text: path.startsWith("private/") ? PRIVATE : NOTE });
    metadata.set(path, { frontmatter: {}, tags: [], headings: [] });
  }
  const corpus = createCorpusStore({
    vault, metadata, clock, sliceMs: 12,
    exclusion: createExclusionPolicy({ folders: ["private"], tags: [], frontmatterKey: "vault-synapse" }),
  });
  cleanup.push(() => corpus.dispose());
  await corpus.warm();
  expect(corpus.reader().list()).toHaveLength(1);
  const deps: CoreToolDeps = {
    getDoc: (path) => corpus.reader().get(path),
    listDocs: () => corpus.reader().list(),
    scanText: (opts) => corpus.indexes().text.scan(opts),
    searchTitles: (query) => corpus.indexes().title.search(query),
    readText: (path) => vault.readText(path),
    outgoing: (path) => corpus.indexes().links.outgoing(path),
    incoming: (path) => corpus.indexes().links.incoming(path),
    unresolvedCount: (path) => corpus.unresolvedCount(path),
    pathsForTag: (tag, opts) => corpus.indexes().tag.pathsForTag(tag, opts),
    getFrontmatter: (path) => corpus.getFrontmatter(path),
    lastTouchedAt: (path) => corpus.session().lastTouched(path),
    clock, sliceMs: 12, budgetMs: 2000,
  };
  const tools = createToolRegistry({ handlers: {
    search_text: createSearchTextHandler(deps),
    search_by_title: createSearchByTitleHandler(deps),
    search_by_tag: createSearchByTagHandler(deps),
    get_links: createGetLinksHandler(deps),
    get_backlinks: createGetBacklinksHandler(deps),
    get_frontmatter: createGetFrontmatterHandler(deps),
    list_recent: createListRecentHandler(deps),
    read_note: createReadNoteHandler(deps),
  } });
  const transport = new NodeHttpTransport({ checkEndpoint: (url) => {
    if (new URL(url).origin !== server.origin) throw new Error("Unexpected test endpoint");
  } });
  const pipeline = createQaPipeline({
    model: new OpenRouterClient({ transport, endpoint: server.endpoint, model: "openrouter/free", apiKey: "synthetic-test-key" }),
    tools, readText: (path) => vault.readText(path),
  });
  const queue = createJobQueue({ clock, abortable: transport.capabilities.abortable });
  cleanup.push(() => queue.dispose());
  const events: QaEvent[] = [];
  const handle = queue.submit({
    kind: "qa", label: "Q&A integration",
    run: (ctx) => pipeline.run({ question: "Where is the quantum rendezvous?", history: [] }, ctx, (event) => events.push(event)),
  });
  const result = await handle.result;
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(handle.state.get()).toBe("done");
  expect(server.remaining()).toBe(0);
  expect(server.requests).toHaveLength(outputs.length);
  for (const request of server.requests) {
    expect(request.url).toBe("/api/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer synthetic-test-key");
    const body = request.body as OpenRouterChatRequest;
    expect(body).toMatchObject({ model: "openrouter/free", temperature: 0, response_format: { type: "json_object" } });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages[0]).toEqual({ role: "system", content: SHARED_SYSTEM_PREFIX });
    expect(body.messages[1]?.role).toBe("user");
  }
  const visible = JSON.stringify({ requests: server.requests, result: result.value, events });
  expect(visible).not.toContain("EXCLUDED_SENTINEL_73");
  expect(visible).not.toContain("private/secret.md");
  return { value: result.value, events, server };
}

describe("queued Q&A over mock OpenRouter HTTP", () => {
  it("indexes FakeVault and returns sourced claims with real tool traces (AC-M3.3–3.5)", async () => {
    const { value, events, server } = await run([plan, { read: ["E1"], enough: false }, answer(["E1"])]);
    expect(value.status).toBe("answered");
    expect(value.claims).toHaveLength(1);
    expect(value.claims[0]?.sourced).toBe(true);
    const citation = value.claims[0]?.citations[0];
    expect(citation?.status).toBe("sourced");
    expect(citation?.excerpt.ref.path).toBe("notes/alpha.md");
    expect(citation?.excerpt.text.length).toBeGreaterThan(0);
    expect(NOTE).toContain(citation?.excerpt.text);
    expect(value.trace.map((hop) => hop.tool)).toEqual(["search_text", "read_note"]);
    expect(value.trace.every((hop) => hop.resultCount > 0)).toBe(true);
    expect(events.filter((event) => event.type === "stage").map((event) => event.stage)).toEqual([
      "queued", "planning", "searching", "selecting", "reading", "answering", "verifying",
    ]);
    expect(value.stats.modelCalls).toBe(3);
    expect(JSON.stringify(server.requests.at(-1)?.body)).toContain("The quantum rendezvous");
  });

  it("returns insufficient without inventing claims or citations (AC-M3.6)", async () => {
    const { value } = await run([
      { ...plan, searches: [{ ...plan.searches[0], terms: ["absentterm"] }] },
      { read: [], enough: true },
      { status: "insufficient", claims: [], followup: null },
    ]);
    expect(value.status).toBe("insufficient");
    expect(value.claims).toEqual([]);
    expect(value.trace[0]).toMatchObject({ tool: "search_text", resultCount: 0 });
  });

  it("retries forged citation IDs once and keeps persistent failures unverified (AC-M3.4)", async () => {
    const { value, server } = await run([
      plan, { read: [], enough: true }, answer(["E1", "E999"]), answer(["E1", "E999"]),
    ]);
    expect(value.claims[0]?.sourced).toBe(false);
    expect(value.claims[0]?.citations).toHaveLength(1);
    expect(value.claims[0]?.citations[0]?.status).toBe("unverified");
    expect(value.stats.modelCalls).toBe(4);
    expect(JSON.stringify(server.requests[3]?.body)).toContain("Previous answer cited unknown IDs (do not reuse): E999");
  });
});
