import { expect, it, vi } from "vitest";
import { createControlStore, CONTROL_STARTERS } from "../../src/instructions";
import { validateControlPaths } from "../../src/core";
import { createCorpusStore } from "../../src/corpus";
import { createExclusionPolicy } from "../../src/policy";
import { FakeVault, FakeMetadata, FakeClock } from "../fakes";

it("reads configured controls privately while excluding controls/inbox from corpus and indexes", async () => {
  const paths = validateControlPaths({ instructions: "Config/Style.md", security: "Config/Rules.md", research: "Inbox/Research.md" });
  if (!paths.ok) throw new Error("fixture");
  const vault = new FakeVault();
  const metadata = new FakeMetadata();
  for (const [path, text] of [
    [paths.value.instructions, CONTROL_STARTERS.instructions], [paths.value.security, CONTROL_STARTERS.security],
    [paths.value.research, "private inbox"], ["config/rules.md", "case alias"], ["Public.md", "ordinary content"],
  ]) {
    vault.addNote({ path, text });
    metadata.set(path, { frontmatter: {}, tags: [], headings: [] });
  }
  // Remove the collision for the privileged loader; exclusion still tested below with alias.
  vault.remove("config/rules.md");
  const controls = createControlStore({ vault, paths: paths.value, starters: CONTROL_STARTERS });
  await controls.reload();
  expect(controls.status.get().security.status).toBe("ready");
  vault.addNote({ path: "config/rules.md", text: "case alias" });
  const read = vi.spyOn(vault, "readText");
  const corpus = createCorpusStore({ vault, metadata, clock: new FakeClock(), sliceMs: 10,
    exclusion: createExclusionPolicy({ folders: [], tags: [], frontmatterKey: "vault-synapse", controlPaths: Object.values(paths.value) }) });
  await corpus.warm(new AbortController().signal);
  expect(corpus.reader().list().map((doc) => doc.ref.path)).toEqual(["Public.md"]);
  expect(read.mock.calls.map(([path]) => path)).toEqual(["Public.md"]);
  expect(corpus.indexes().title.search("Rules")).toEqual([]);
  corpus.dispose(); controls.dispose();
});
