import { expect, it, vi } from "vitest";
import { NodeHttpTransport } from "../../src/adapters/node";
import { createObsidianNoteWriter } from "../../src/adapters/obsidian";
import { DEFAULT_BONSAI_ENDPOINT, DEFAULT_BONSAI_MODEL } from "../../src/constants";
import { asVaultPath, parseNoteFrontmatter } from "../../src/core";
import { createJobQueue } from "../../src/jobs";
import { BonsaiClient } from "../../src/llm";
import { createEndpointPolicy, createExclusionPolicy } from "../../src/policy";
import { createMetadataRepair } from "../../src/research";
import { FakeActiveNote, FakeClock, FakeMetadata, FakeVault } from "../fakes";
it.skipIf(process.env.SYNAPSE_LIVE_BONSAI !== "1")("Bonsai live metadata proposal through production queue and schema preserves body without writing", async () => {
  const policy = createEndpointPolicy({ provider: "bonsai", endpointAckHost: null });
  const transport = new NodeHttpTransport({ checkEndpoint: (url) => policy.assertAllowed(url) });
  const clock = new FakeClock(); clock.now = () => Date.now(); clock.mono = () => performance.now();
  const jobs = createJobQueue({ clock });
  const model = new BonsaiClient({ transport, endpoint: DEFAULT_BONSAI_ENDPOINT, model: DEFAULT_BONSAI_MODEL });
  const vault = new FakeVault(), metadata = new FakeMetadata();
  const text = "# Field report\nThe Aster observatory admits visitors on Thursday. This note records the visiting timetable and access policy.";
  const path = asVaultPath("Field.md"); vault.addNote({ path, text }); metadata.set(path, { tags: [], frontmatter: {}, headings: [] });
  const write = vi.fn(async () => { throw Error("No write authorized"); });
  const service = createMetadataRepair({ path, paths: { instructions: asVaultPath("Instructions.md"), research: asVaultPath("Research.md") }, vault, metadata, activeNote: new FakeActiveNote(), jobs, model,
    writer: createObsidianNoteWriter({ entries: () => [], editors: () => [], exists: async () => false, read: async () => text, process: write, create: write }),
    exclusion: createExclusionPolicy({ folders: [], tags: [], frontmatterKey: "synapse" }), version: () => "current", subscribe: () => () => {} });
  const started = performance.now();
  try {
    const result = await service.propose().result;
    console.info("BONSAI_METADATA", JSON.stringify({ ok: result.ok, elapsedMs: Math.round(performance.now() - started) }));
    expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error.code);
    const after = result.value.proposal.changes[0].after;
    const parsed = parseNoteFrontmatter(after);
    expect(parsed.issues).toEqual([]);
    expect(after.slice(parsed.end)).toBe(text);
    expect(String(parsed.value.description).toLowerCase()).toMatch(/observatory|visiting|aster/);
    expect(write).not.toHaveBeenCalled(); expect(await vault.readText(path)).toBe(text);
  } finally { service.dispose(); jobs.dispose(); }
}, 120_000);
