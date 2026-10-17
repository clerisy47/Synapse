import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { asVaultPath, estimateTokens, parseNoteFrontmatter, type DocMeta } from "../../src/core";
import { createCorpusStore } from "../../src/corpus";
import { createSearchTextHandler, type CoreToolDeps, type SearchTextResult } from "../../src/tools";
import { createExclusionPolicy } from "../../src/policy";
import { createSearchTextHandler as legacySearch } from "../fixtures/pre-metadata-search";
import { FakeClock, FakeCorpus, FakeMetadata, FakeVault } from "../fakes";
const cases = [
  { query: "Stargazer", expected: "Metadata/01.md", fact: "Thursday" },
  { query: "Portlight", expected: "Metadata/02.md", fact: "Mira" },
  { query: "access timetable", expected: "Metadata/01.md", fact: "Thursday" },
  { query: "coordination", expected: "Metadata/02.md", fact: "Mira" },
  { query: "observatory", expected: "Topic.md", fact: "Tuesday" },
  { query: "backup custodian", expected: "Metadata/Missing.md", fact: "Noor" },
  { query: "Sunday", expected: null, fact: "" },
];
export async function metadataEvaluationFixture() {
  const vault = new FakeVault(), metadata = new FakeMetadata(), clock = new FakeClock();
  const seeds = [];
  const names = (await readdir("test/mini-vault", { recursive: true })).filter((p) => p.endsWith(".md") && p !== "Research.md" && !p.startsWith("Synapse/"));
  for (const path of names) {
    const text = await readFile(`test/mini-vault/${path}`, "utf8");
    const parsed = parseNoteFrontmatter(text);
    const tags = parsed.value.tags as string[] | undefined ?? [];
    const aliases = parsed.value.aliases as string[] | undefined ?? [];
    vault.addNote({ path, text }); metadata.set(path, { frontmatter: parsed.value, tags, headings: [] });
    seeds.push({ path, text, tags, aliases, frontmatter: parsed.value });
  }
  const old = new FakeCorpus(seeds, { clock });
  const corpus = createCorpusStore({ vault, metadata, clock, sliceMs: 10, exclusion: createExclusionPolicy({ folders: [], tags: [], frontmatterKey: "synapse", controlPaths: ["Research.md", "Synapse/Instructions.md"] }) });
  await corpus.warm();
  const deps: CoreToolDeps = { ...old.asDeps(), getDoc: (p) => corpus.reader().get(p), listDocs: () => corpus.reader().list(), scanText: (o) => corpus.indexes().text.scan(o), searchTitles: (q) => corpus.indexes().title.search(q), readText: (p) => vault.readText(p), pathsForTag: (t, o) => corpus.indexes().tag.pathsForTag(t, o), getFrontmatter: (p) => corpus.getFrontmatter(p) };
  return { old, corpus, deps, vault, clock };
}
describe("project mini-vault metadata comparison", () => {
  it("measures discovery, known facts and bounded context before/after, including the mandatory-metadata recall regression", async () => {
    const f = await metadataEvaluationFixture();
    try {
      const rows = [];
      for (const scenario of cases) {
        const metrics = [];
        for (const handler of [legacySearch(f.old.asDeps()), createSearchTextHandler(f.deps)]) {
          const result = await handler({ terms: [scenario.query], phrases: [], limit: 6 }, { signal: new AbortController().signal });
          if (!result.ok) throw Error("search failed");
          const data = result.data as SearchTextResult;
          const target = data.hits.find((h) => h.ref.path === scenario.expected);
          const verified = !!target?.excerpts.some((e) => e.text.includes(scenario.fact));
          metrics.push({ discovered: !!target, bodyFact: verified, toolCalls: 1, contextChars: JSON.stringify(data).length, estimatedTokens: estimateTokens(JSON.stringify(data)), hits: data.hits.length });
          for (const h of data.hits) for (const e of h.excerpts) expect(e.text).toBe((await f.vault.readText(e.ref.path)).slice(e.locator.start, e.locator.end));
          if (handler !== undefined && scenario.query === "Sunday") expect(data.hits.every((h) => h.excerpts.every((e) => !e.text.includes("opens on Sunday")))).toBe(true);
        }
        rows.push({ query: scenario.query, before: metrics[0], after: metrics[1] });
      }
      console.info("METADATA_EVALUATION", JSON.stringify(rows));
      expect(rows.filter((r) => r.before.bodyFact)).toHaveLength(2);
      expect(rows.filter((r) => r.after.bodyFact)).toHaveLength(5);
      expect(f.corpus.repairs().map((r) => r.path)).toEqual(["Metadata/Missing.md", "README.md"]);
      expect(f.deps.getDoc(asVaultPath("Metadata/Missing.md"))).toBeNull();
      const docs: readonly DocMeta[] = f.deps.listDocs();
      expect(docs.every((d) => !!d.description)).toBe(true);
      const stale = await createSearchTextHandler(f.deps)({ terms: ["Sunday"], phrases: [], limit: 6 }, { signal: new AbortController().signal });
      expect(stale.ok && (stale.data as SearchTextResult).hits.length).toBe(1);
      if (stale.ok) expect((stale.data as SearchTextResult).hits[0].excerpts[0].text).toContain("Cedar garden");
    } finally { f.corpus.dispose(); }
  });
});

it.skipIf(process.env.SYNAPSE_LIVE_BONSAI !== "1")("Bonsai live controlled mini-vault before/after answers verify bodies despite stale metadata", async () => {
  const { NodeHttpTransport } = await import("../../src/adapters/node");
  const { BonsaiClient } = await import("../../src/llm");
  const { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } = await import("../../src/constants");
  const { createEndpointPolicy } = await import("../../src/policy");
  const { createToolRegistry, createReadNoteHandler } = await import("../../src/tools");
  const { createQaPipeline } = await import("../../src/agent");
  const { createJobQueue } = await import("../../src/jobs");
  const { ok } = await import("../../src/core");
  const f = await metadataEvaluationFixture();
  f.clock.now = () => Date.now(); f.clock.mono = () => performance.now();
  const endpoint = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const model = new BonsaiClient({ transport: new NodeHttpTransport({ checkEndpoint: (url) => endpoint.assertAllowed(url) }), endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL });
  const jobs = createJobQueue({ clock: f.clock });
  const rows = [];
  try {
    for (const scenario of [
      { query: "Stargazer", question: "On which weekday does Stargazer admit visitors?", fact: "Thursday" },
      { query: "Portlight", question: "Who is the coordinator of Portlight?", fact: "Mira" },
      { query: "Sunday", question: "Does the vault support the claim that the Aster observatory admits visitors on Sunday?", fact: null },
    ]) {
      for (const variant of ["before", "after"] as const) {
        const deps = variant === "before" ? f.old.asDeps() : f.deps;
        const tools = createToolRegistry({ handlers: { search_text: variant === "before" ? legacySearch(deps) : createSearchTextHandler(deps), read_note: createReadNoteHandler(deps) } });
        const pipeline = createQaPipeline({ numCtx: 4096, selectorStrategy: "top-k", tools, readText: (p) => f.vault.readText(p),
          access: { version: "synthetic", current: () => true, sanitize: (text) => text, project: (e) => ({ title: e.ref.path, text: e.text }) },
          model: { generate: async (request, signal) => {
            if (request.kind === "qa.plan") return ok({ value: request.schema.parse({ searches: [{ tool: "search_text", terms: [scenario.query], phrases: [], tag: null, days: null }], expand_graph: false }), attempts: 1, usage: { promptTokens: 0, outputTokens: 0, loadMs: 0, promptEvalMs: 0, evalMs: 0, totalMs: 0 } });
            return model.generate(request, signal);
          } },
        });
        const result = await jobs.submit({ kind: "qa", label: "synthetic metadata comparison", run: (ctx) => pipeline.run({ question: scenario.question, history: [] }, ctx, () => {}) }).result;
        expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error.code);
        const value = result.value;
        const correct = scenario.fact === null ? value.status === "insufficient" : value.status === "answered" && value.claims.some((c) => c.text.includes(scenario.fact!));
        rows.push({ query: scenario.query, variant, status: value.status, correct, sourced: value.claims.every((c) => c.sourced), ...value.stats });
        console.info("BONSAI_METADATA_COMPARISON", JSON.stringify(rows[rows.length - 1]));
        if (variant === "after") expect(correct).toBe(true);
        expect(value.claims.every((c) => c.sourced)).toBe(true);
      }
    }
  } finally { jobs.dispose(); f.corpus.dispose(); }
}, 240_000);
