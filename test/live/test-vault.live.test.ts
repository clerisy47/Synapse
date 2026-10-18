/** Opt-in read-only evaluation of the operator's test vault. Logs metrics only. */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseNoteFrontmatter, proposeMissingMetadata } from "../../src/core";
import { createCorpusStore } from "../../src/corpus";
import { createQaPipeline } from "../../src/agent";
import { createJobQueue } from "../../src/jobs";
import { BonsaiClient } from "../../src/llm";
import { NodeHttpTransport } from "../../src/adapters/node";
import { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } from "../../src/constants";
import { createEndpointPolicy, createExclusionPolicy } from "../../src/policy";
import { createToolRegistry, createSearchTextHandler, createSearchByTitleHandler, createSearchByTagHandler, createReadNoteHandler, createGetLinksHandler, createGetBacklinksHandler, createGetFrontmatterHandler, createListRecentHandler, type CoreToolDeps } from "../../src/tools";
import { FakeClock, FakeMetadata, FakeVault, fixtureDisclosureAccess } from "../fakes";

it.skipIf(process.env.SYNAPSE_TEST_VAULT !== "1")("evaluates actual test-vault baseline and repaired in-memory live workflows without disk writes", async () => {
  const root = "Synapse-Test-Vault";
  const names = (await readdir(root, { recursive: true })).filter(p => p.endsWith(".md") && !p.startsWith(".obsidian/")).sort();
  const originals = new Map(await Promise.all(names.map(async p => [p, await readFile(`${root}/${p}`, "utf8")] as const)));
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  const before = new Map([...originals].map(([p, s]) => [p, digest(s)]));
  const clock = new FakeClock(); clock.now = () => Date.now(); clock.mono = () => performance.now();
  const jobs = createJobQueue({ clock });
  const endpoint = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const model = new BonsaiClient({ transport: new NodeHttpTransport({ checkEndpoint: u => endpoint.assertAllowed(u) }), endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL });
  const queries = [...(originals.get("Test Queries.md") ?? "").matchAll(/^\| (.+?) \| (.+?) \|$/gm)].filter(m => m[1] !== "Prompt" && !/^-+$/.test(m[1]));
  expect(queries.length).toBe(10);
  const rows: unknown[] = [];
  try {
    for (const repaired of [false, true]) {
      const vault = new FakeVault(), metadata = new FakeMetadata();
      const links: Record<string, Record<string, number>> = {};
      for (const [p, original] of originals) {
        const body = original.slice(parseNoteFrontmatter(original).end);
        // Deterministic fixture preparation, not model-generated repair or approved application.
        const text = repaired ? proposeMissingMetadata(original, { description: body.split(/\n\s*\n/).find(s => !s.startsWith("#") && s.trim().length > 0)?.replace(/\s+/g, " ").slice(0, 240) || p.replace(/\.md$/, ""), tags: ["evaluation"], aliases: [] }) ?? original : original;
        if (repaired) expect(parseNoteFrontmatter(text).issues).toEqual([]);
        expect(text.slice(parseNoteFrontmatter(text).end)).toBe(body);
        vault.addNote({ path: p, text });
        metadata.set(p, { frontmatter: parseNoteFrontmatter(text).value, tags: repaired ? ["evaluation"] : [], headings: [] });
        links[p] = {};
        for (const match of body.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
          const targets = names.filter(n => n === `${match[1]}.md` || n.endsWith(`/${match[1]}.md`));
          if (targets.length === 1) links[p][targets[0]] = (links[p][targets[0]] ?? 0) + 1;
        }
      }
      metadata.setResolvedLinks(links);
      const corpus = createCorpusStore({ vault, metadata, clock, sliceMs: 12, exclusion: createExclusionPolicy({ folders: [], tags: [], frontmatterKey: "synapse", controlPaths: ["Research.md", "Synapse/Instructions.md"] }) });
      await corpus.warm();
      try {
        console.info("TEST_VAULT_AUDIT", JSON.stringify({ repaired, files: names.length, indexed: corpus.reader().list().length, repairs: corpus.repairs().length }));
        const deps: CoreToolDeps = { getDoc: p => corpus.reader().get(p), listDocs: () => corpus.reader().list(), scanText: o => corpus.indexes().text.scan(o), searchTitles: q => corpus.indexes().title.search(q), readText: p => vault.readText(p), outgoing: p => corpus.indexes().links.outgoing(p), incoming: p => corpus.indexes().links.incoming(p), unresolvedCount: p => corpus.unresolvedCount(p), pathsForTag: (t,o) => corpus.indexes().tag.pathsForTag(t,o), getFrontmatter: p => corpus.getFrontmatter(p), lastTouchedAt: p => corpus.session().lastTouched(p), clock, sliceMs: 12, budgetMs: 2000 };
        const tools = createToolRegistry({ handlers: { search_text: createSearchTextHandler(deps), search_by_title: createSearchByTitleHandler(deps), search_by_tag: createSearchByTagHandler(deps), read_note: createReadNoteHandler(deps), get_links: createGetLinksHandler(deps), get_backlinks: createGetBacklinksHandler(deps), get_frontmatter: createGetFrontmatterHandler(deps), list_recent: createListRecentHandler(deps) } });
        const pipeline = createQaPipeline({ model, tools, readText: p => vault.readText(p), access: fixtureDisclosureAccess(), numCtx: 4096 });
        for (const [i, query] of queries.entries()) {
          // Baseline needs only one live demonstration when every note is gated.
          if (!repaired && i > 0 && corpus.reader().list().length === 0) continue;
          const started = performance.now();
          const result = await jobs.submit({ kind: "qa", label: "Read-only vault evaluation", run: ctx => pipeline.run({ question: query[1], history: [] }, ctx, () => {}) }).result;
          const expectedPaths = [...query[2].matchAll(/\[\[([^\]]+)\]\]/g)].map(m => names.find(n => n === `${m[1]}.md` || n.endsWith(`/${m[1]}.md`)));
          const value = result.ok ? result.value : null;
          const row = { case: i + 1, repaired, ok: result.ok, ...(result.ok ? {} : { error: result.error.code }), status: value?.status, sourced: value?.claims.every(c => c.sourced), relevantCitation: value?.claims.some(c => c.citations.some(citation => expectedPaths.includes(citation.excerpt.ref.path))), expectedAnswer: expectedPaths.length > 0, elapsedMs: Math.round(performance.now() - started), stats: value?.stats };
          rows.push(row); console.info("TEST_VAULT_CASE", JSON.stringify(row));
          if (value) for (const claim of value.claims) for (const citation of claim.citations) {
            expect(names).toContain(citation.excerpt.ref.path);
            expect((await vault.readText(citation.excerpt.ref.path)).includes(citation.excerpt.text)).toBe(true);
            expect(citation.status).toBe("sourced");
          }
        }
        if (repaired) expect(corpus.reader().list().length).toBe(names.length);
      } finally { corpus.dispose(); }
    }
  } finally {
    jobs.dispose();
    for (const p of names) expect(digest(await readFile(`${root}/${p}`, "utf8"))).toBe(before.get(p));
    console.info("TEST_VAULT_UNCHANGED", JSON.stringify({ verified: names.length, cases: rows.length }));
  }
}, 900_000);
