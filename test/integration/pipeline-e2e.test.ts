import { fixtureDisclosureAccess } from "../fakes";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL, DEFAULT_OPENROUTER_BASE_URL, DEFAULT_OPENROUTER_MODEL, OPENROUTER_API_KEY_ENV } from "../../src/constants";
import { NodeHttpTransport } from "../../src/adapters/node";
import type { Transport } from "../../src/core";
import { completionMetadata } from "../live/completion-metadata";
import { createQaPipeline, type QaEvent } from "../../src/agent";
import { createCorpusStore } from "../../src/corpus";
import { createJobQueue } from "../../src/jobs";
import { BonsaiClient, OpenRouterClient, planOutputSchema, SHARED_SYSTEM_PREFIX, type OpenRouterChatRequest } from "../../src/llm";
import { createEndpointPolicy, createExclusionPolicy } from "../../src/policy";
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

async function run(outputs: unknown[], opts: { bonsai?: boolean; live?: boolean; graph?: boolean; stale?: boolean; maxReads?: number; fixture?: { note: string; question: string } } = {}) {
  const server = await startMockOpenRouterServer(outputs);
  cleanup.push(server.close);
  const clock = new FakeClock(1_700_000_000_000);
  if (opts.live || opts.bonsai) {
    clock.now = () => Date.now();
    clock.mono = () => performance.now();
  }
  const vault = new FakeVault();
  const metadata = new FakeMetadata();
  for (const path of ["notes/alpha.md", "private/secret.md"]) {
    vault.addNote({ path, text: path.startsWith("private/") ? PRIVATE : (opts.fixture?.note ?? NOTE) });
    metadata.set(path, { frontmatter: {}, tags: [], headings: [] });
  }
  if (opts.graph) {
    vault.addNote({ path: "notes/linked.md", text: "The rendezvous location is Beta, as confirmed by the linked schedule. This schedule is the authoritative destination for the team meeting." });
    metadata.set("notes/linked.md", { frontmatter: {}, tags: [], headings: [] });
    metadata.setResolvedLinks({ "notes/alpha.md": { "notes/linked.md": 1 } });
  }
  const corpus = createCorpusStore({
    vault, metadata, clock, sliceMs: 12,
    exclusion: createExclusionPolicy({ folders: ["private"], tags: [], frontmatterKey: "vault-synapse" }),
  });
  cleanup.push(() => corpus.dispose());
  await corpus.warm();
  expect(corpus.reader().list()).toHaveLength(opts.graph ? 2 : 1);
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
  const transport = new NodeHttpTransport(opts.bonsai ? { checkEndpoint: createEndpointPolicy({ provider: "bonsai", endpointAckHost: null }).assertAllowed } : opts.live ? {} : { checkEndpoint: (url) => {
    if (new URL(url).origin !== server.origin) throw new Error("Unexpected test endpoint");
  } });
  const measuredTransport: Transport = opts.live || opts.bonsai ? {
    capabilities: transport.capabilities,
    getJson: (url, options) => transport.getJson(url, options),
    async *postStream(url, body, options) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("EXCLUDED_SENTINEL_73");
      expect(serialized).not.toContain("private/secret.md");
      for await (const response of transport.postStream(url, body, options)) {
        if (opts.live) console.info("Phase A live completion metadata", JSON.stringify(completionMetadata(response)));
        yield response;
      }
    },
  } : transport;
  const model = opts.bonsai ? new BonsaiClient({ transport: measuredTransport, endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL }) : new OpenRouterClient({ transport: measuredTransport, endpoint: opts.live ? DEFAULT_OPENROUTER_BASE_URL : server.endpoint, model: DEFAULT_OPENROUTER_MODEL, apiKey: opts.live ? (process.env[OPENROUTER_API_KEY_ENV] ?? null) : "synthetic-test-key" });
  const pipeline = createQaPipeline({
    access: fixtureDisclosureAccess(),
    budget: opts.maxReads === undefined ? {} : { maxReads: opts.maxReads },
    model: { async generate(request, signal) {
      const result = await model.generate(request, signal);
      if (opts.bonsai && process.env.SYNAPSE_LIVE_BONSAI_DIAGNOSTIC === "1" && request.kind === "qa.plan" && result.ok) {
        const parsed = planOutputSchema.safeParse(result.value.value);
        if (parsed.success) console.info("Bonsai live plan shape", JSON.stringify(parsed.data.searches.map(search => ({
          tool: search.tool,
          terms: search.terms.map(term => ({ characters: term.length, words: term.split(/\s+/u).length,
            occursInNote: (opts.fixture?.note ?? NOTE).toLowerCase().includes(term.toLowerCase()) })),
          phrases: search.phrases.map(phrase => ({ characters: phrase.length,
            occursInNote: (opts.fixture?.note ?? NOTE).toLowerCase().includes(phrase.toLowerCase()) })),
        }))));
      }
      return result;
    } },
    tools, readText: (path) => opts.stale ? Promise.resolve("replacement text without the cited passage") : vault.readText(path),
  });
  const queue = createJobQueue({ clock, abortable: transport.capabilities.abortable });
  cleanup.push(() => queue.dispose());
  const events: QaEvent[] = [];
  const handle = queue.submit({
    kind: "qa", label: "Q&A integration",
    run: (ctx) => pipeline.run({ question: opts.fixture?.question ?? "Where is the quantum rendezvous?", history: [] }, ctx, (event) => events.push(event)),
  });
  const result = await handle.result;
  expect(result.ok, result.ok ? undefined : result.error.code).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(handle.state.get()).toBe("done");
  expect(server.remaining()).toBe(0);
  if (!opts.live && !opts.bonsai) expect(server.requests).toHaveLength(outputs.length);
  for (const [index, request] of server.requests.entries()) {
    expect(request.url).toBe("/api/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer synthetic-test-key");
    const body = request.body as OpenRouterChatRequest;
    expect(body).toMatchObject({ model: "openrouter/free", temperature: 0, response_format: { type: "json_object" } });
    if (index === 0) expect(body).not.toHaveProperty("max_tokens");
    else expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages[0]).toEqual({ role: "system", content: SHARED_SYSTEM_PREFIX });
    expect(body.messages[1]?.role).toBe("user");
  }
  expect(await vault.readText("notes/alpha.md" as Parameters<typeof vault.readText>[0])).toBe(opts.fixture?.note ?? NOTE);
  expect(await vault.readText("private/secret.md" as Parameters<typeof vault.readText>[0])).toBe(PRIVATE);
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


describe("iterative retrieval completion", () => {
  it.each([false, true])("requires a revised second search before evidence can answer (phrase only: %s)", async (phraseOnly) => {
    const { value, server } = await run([
      { ...plan, searches: [{ ...plan.searches[0], terms: ["absentterm"] }] },
      { read: [], enough: true },
      { status: "insufficient", claims: [], followup: { terms: phraseOnly ? [] : ["quantum"], phrases: phraseOnly ? ["quantum rendezvous"] : [] } },
      { read: ["E1"], enough: true }, answer(["E1"]),
    ]);
    expect(value.status).toBe("answered");
    expect(value.claims[0]?.sourced).toBe(true);
    expect(value.trace.filter((hop) => hop.tool === "search_text").map((hop) => hop.resultCount)).toEqual([0, 1]);
    expect(JSON.stringify(server.requests[2]?.body)).not.toContain(NOTE);
    expect(JSON.stringify(server.requests[4]?.body)).toContain("quantum rendezvous");
  });
  it("follows graph references into bounded current Markdown evidence", async () => {
    const { value, server } = await run([
      { ...plan, expand_graph: true }, { read: ["E2"], enough: true }, answer(["E2"]),
    ], { graph: true });
    expect(value.claims[0]?.citations[0]?.excerpt.ref.path).toBe("notes/linked.md");
    expect(value.claims[0]?.sourced).toBe(true);
    expect(value.trace.map((hop) => hop.tool)).toContain("get_links");
    expect(value.trace.map((hop) => hop.tool)).toContain("read_note");
    expect(value.stats.reads).toBe(1);
    expect(value.stats.hops).toBeLessThanOrEqual(6);
    expect(JSON.stringify(server.requests[2]?.body)).toContain("location is Beta");
  });
  it("marks vanished passages unverified", async () => {
    const { value } = await run([plan, { read: [], enough: true }, answer(["E1"])], { stale: true });
    expect(value.claims[0]?.sourced).toBe(false);
    expect(value.claims[0]?.citations[0]?.status).toBe("unverified");
  });
});

it("does not read graph targets when the read budget is zero", async () => {
  const { value } = await run([{ ...plan, expand_graph: true }, { read: [], enough: true }, answer(["E1"])], { graph: true, maxReads: 0 });
  expect(value.stats.reads).toBe(0);
  expect(value.trace.some((hop) => hop.tool === "read_note")).toBe(false);
});

// Known answers are independently stored in the fixture table. Scripted HTTP
// responses test orchestration/schema/citation integrity, not model intelligence.
const facts = [
  ["Atlas", "owner", "Mira"], ["Beacon", "owner", "Tomas"],
  ["Cedar", "owner", "Leena"], ["Delta", "owner", "Ravi"],
  ["Ember", "owner", "Nora"], ["Fjord", "owner", "Ivo"],
  ["Grove", "owner", "Sana"], ["Harbor", "owner", "Omar"],
  ["Indigo", "owner", "Ada"], ["Juniper", "owner", "Theo"],
  ["Kestrel", "venue", "Oslo"], ["Lagoon", "venue", "Kyoto"],
  ["Maple", "venue", "Lima"], ["Nimbus", "venue", "Accra"],
  ["Orchid", "venue", "Bern"], ["Pebble", "venue", "Riga"],
  ["Quartz", "venue", "Pune"], ["Reef", "venue", "Bath"],
  ["Summit", "venue", "Kobe"], ["Tundra", "venue", "Perth"],
  ["Umber", "weekday", "Monday"], ["Vale", "weekday", "Tuesday"],
  ["Willow", "weekday", "Wednesday"], ["Xenon", "weekday", "Thursday"],
  ["Yarrow", "weekday", "Friday"], ["Zephyr", "weekday", "Saturday"],
  ["Acorn", "weekday", "Sunday"], ["Birch", "weekday", "Monday"],
  ["Coral", "weekday", "Tuesday"], ["Dune", "weekday", "Wednesday"],
  ["Elm", "status", "approved"], ["Flint", "status", "paused"],
  ["Glade", "status", "active"], ["Hazel", "status", "complete"],
  ["Iris", "status", "scheduled"], ["Jade", "status", "reviewed"],
  ["Knoll", "status", "draft"], ["Larch", "status", "archived"],
  ["Moss", "status", "queued"], ["North", "status", "blocked"],
] as const;

describe("Phase A known-answer evaluation (scripted HTTP)", () => {
  const measurements: { correct: boolean; cited: boolean; elapsedMs: number }[] = [];
  afterAll(() => {
    // Aggregate counts only: no questions, note bodies, keys, or paths.
    console.info("Phase A scripted evaluation", JSON.stringify({
      mode: "scripted-http", questions: measurements.length,
      correct: measurements.filter((m) => m.correct).length,
      validCitations: measurements.filter((m) => m.cited).length,
      elapsedMs: measurements.map((m) => Math.round(m.elapsedMs)),
    }));
  });
  it.each(facts)("%s %s resolves to current evidence", async (project, field, expected) => {
    const started = performance.now();
    const claim = `${project}'s ${field} is ${expected}.`;
    const note = `${claim} This synthetic project record is the authoritative schedule and ownership register for evaluation purposes.`;
    const { value } = await run([
      { ...plan, searches: [{ ...plan.searches[0], terms: [project] }] },
      { read: ["E1"], enough: false },
      { status: "answered", claims: [{ text: claim, sources: ["E1"] }], followup: null },
    ], { fixture: { note, question: `What is ${project}'s ${field}?` } });
    const correct = value.status === "answered" && value.claims.length === 1
      && value.claims[0]?.text === claim && value.claims[0]?.text.includes(expected);
    const citation = value.claims[0]?.citations[0];
    const cited = value.claims[0]?.sourced === true && citation?.status === "sourced"
      && citation.excerpt.ref.path === "notes/alpha.md"
      && note.includes(citation.excerpt.text) && citation.excerpt.text.includes(expected);
    measurements.push({ correct, cited, elapsedMs: performance.now() - started });
    expect(correct).toBe(true);
    expect(cited).toBe(true);
    expect(value.trace.map((hop) => hop.tool)).toContain("read_note");
  });
});

// Opt-in smoke only: one real pipeline question, not the 40-question quality gate.
describe("Phase A live Q&A smoke", () => {
  it.skipIf(!process.env[OPENROUTER_API_KEY_ENV] || process.env.SYNAPSE_LIVE_QA !== "1")(
    "answers a synthetic question with a current verified citation",
    async () => {
      const started = performance.now();
      const { value } = await run([], { live: true });
      const correct = value.status === "answered"
        && value.claims.some((claim) => claim.text.includes("Alpha"));
      const cited = value.claims.some((claim) => claim.text.includes("Alpha") && claim.sourced
        && claim.citations.some((citation) => citation.status === "sourced"
          && citation.excerpt.ref.path === "notes/alpha.md"
          && NOTE.includes(citation.excerpt.text) && citation.excerpt.text.includes("Alpha")));
      console.info("Phase A live Q&A smoke", JSON.stringify({
        correct, validCitation: cited, elapsedMs: Math.round(performance.now() - started),
        status: value.status,
        modelCalls: value.stats.modelCalls,
        reads: value.stats.reads,
        hops: value.stats.hops,
      }));
      expect(correct).toBe(true);
      expect(cited).toBe(true);
    },
    180_000,
  );
});

describe("Bonsai live Q&A workflow", () => {
  it.skipIf(process.env.SYNAPSE_LIVE_BONSAI !== "1")("retrieves current synthetic evidence and verifies plugin-owned citations", async () => {
    const started = performance.now();
    const { value } = await run([], { bonsai: true });
    const correct = value.status === "answered" && value.claims.some(c => c.text.includes("Alpha"));
    const cited = value.claims.some(c => c.sourced && c.citations.some(ref => ref.status === "sourced" && NOTE.includes(ref.excerpt.text) && ref.excerpt.text.includes("Alpha")));
    console.info("Bonsai live Q&A", JSON.stringify({ correct, validCitation: cited, elapsedMs: Math.round(performance.now() - started), modelCalls: value.stats.modelCalls }));
    expect(correct).toBe(true); expect(cited).toBe(true);
  }, 180_000);
});

describe("Bonsai live known-answer quality evaluation", () => {
  const measurements: { correct: boolean; cited: boolean; elapsedMs: number }[] = [];
  afterAll(() => {
    if (measurements.length === 0) return;
    const elapsed = measurements.map(m => m.elapsedMs).sort((a, b) => a - b);
    console.info("Bonsai live quality aggregate", JSON.stringify({
      questions: measurements.length,
      correct: measurements.filter(m => m.correct).length,
      validCitations: measurements.filter(m => m.cited).length,
      p50Ms: Math.round(elapsed[Math.ceil(elapsed.length * 0.5) - 1] ?? 0),
      p95Ms: Math.round(elapsed[Math.ceil(elapsed.length * 0.95) - 1] ?? 0),
    }));
  });
  it.skipIf(process.env.SYNAPSE_LIVE_BONSAI_QUALITY !== "1")(
    "answers forty independent synthetic questions with current evidence",
    async () => {
      for (const [project, field, expected] of facts) {
        const started = performance.now();
        const note = `${project}'s ${field} is ${expected}. This synthetic project record is the authoritative schedule and ownership register for evaluation purposes.`;
        const { value } = await run([], { bonsai: true, fixture: {
          note, question: `What is ${project}'s ${field}?`,
        } });
        const relevant = value.claims.filter(claim => claim.text.includes(expected));
        const correct = value.status === "answered" && relevant.length > 0;
        const cited = correct && relevant.some(claim => claim.sourced && claim.citations.some(
          citation => citation.status === "sourced" && citation.excerpt.ref.path === "notes/alpha.md"
            && note.includes(citation.excerpt.text) && citation.excerpt.text.includes(expected),
        ));
        measurements.push({ correct, cited, elapsedMs: performance.now() - started });
        console.info("Bonsai live quality case", JSON.stringify({
          case: measurements.length, correct, validCitation: cited,
          elapsedMs: Math.round(performance.now() - started),
          status: value.status, modelCalls: value.stats.modelCalls,
          reads: value.stats.reads,
          tools: value.trace.map(hop => ({ tool: hop.tool, resultCount: hop.resultCount })),
        }));
      }
      expect(measurements).toHaveLength(facts.length);
      expect(measurements.filter(m => m.correct)).toHaveLength(facts.length);
      expect(measurements.filter(m => m.cited).length / facts.length).toBeGreaterThanOrEqual(0.95);
    }, 1_800_000,
  );
});

it.skipIf(process.env.SYNAPSE_LIVE_BONSAI_DIAGNOSTIC !== "1")(
  "Bonsai live diagnoses the first quality fixture without content logging",
  async () => {
    const [project, field, expected] = process.env.SYNAPSE_LIVE_BONSAI_DIAGNOSTIC_CASE === "2" ? facts[1] : facts[0];
    const { value } = await run([], { bonsai: true, fixture: {
      note: `${project}'s ${field} is ${expected}. This synthetic project record is the authoritative schedule and ownership register for evaluation purposes.`,
      question: `What is ${project}'s ${field}?`,
    } });
    console.info("Bonsai live fixture diagnosis", JSON.stringify({
      status: value.status, modelCalls: value.stats.modelCalls, reads: value.stats.reads,
      tools: value.trace.map(hop => ({ tool: hop.tool, resultCount: hop.resultCount, rejected: hop.rejected })),
    }));
    expect(value.status).toBe("answered");
    expect(value.claims.some(claim => claim.text.includes(expected))).toBe(true);
  }, 180_000,
);
