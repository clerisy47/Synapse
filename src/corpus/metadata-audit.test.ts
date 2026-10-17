import { describe, expect, it, vi } from "vitest";
import { asVaultPath } from "../core";
import { createCorpusStore } from "./index";
import { createExclusionPolicy } from "../policy";
import { FakeClock, FakeVault, FakeMetadata } from "../../test/fakes";
import { withMetadata } from "../../test/note-metadata-fixture";
describe("exclusion-first metadata audit", () => {
  it("keeps invalid notes in a local repair list, excludes them from every index, and refreshes after repair", async () => {
    const vault = new FakeVault(), metadata = new FakeMetadata();
    for (const [path, text] of [["Good.md", withMetadata("Body", { aliases: ["Alternative"] })], ["Missing.md", "Original body"], ["Invalid.md", '---\ntags: [""]\n---\nBody'], ["Private.md", "MUST_NOT_READ"], ["Instructions.md", "MUST_NOT_READ"], ["Research.md", "MUST_NOT_READ"]]) {
      vault.addNote({ path, text }); metadata.set(path, { tags: [], frontmatter: {}, headings: [] });
    }
    const read = vi.spyOn(vault, "readText");
    const store = createCorpusStore({ vault, metadata, clock: new FakeClock(), sliceMs: 10,
      exclusion: createExclusionPolicy({ folders: ["Private.md"], tags: [], frontmatterKey: "synapse", controlPaths: ["Instructions.md", "Research.md"] }) });
    await store.warm();
    expect(read.mock.calls.flat()).not.toContain("Private.md");
    expect(read.mock.calls.flat()).not.toContain("Instructions.md");
    expect(read.mock.calls.flat()).not.toContain("Research.md");
    expect(store.repairs().map((r) => r.path)).toEqual(["Invalid.md", "Missing.md"]);
    expect(store.status.get().metadataAttention).toBe(2);
    expect(store.reader().list().map((d) => d.ref.path)).toEqual(["Good.md"]);
    expect(store.indexes().text.paths()).toEqual(["Good.md"]);
    expect(store.indexes().title.search("Missing")).toEqual([]);
    expect(store.getFrontmatter(asVaultPath("Missing.md"))).toBeNull();
    vault.addNote({ path: "Missing.md", text: withMetadata("Original body") }); metadata.emitChanged("Missing.md");
    await vi.waitFor(() => expect(store.reader().has(asVaultPath("Missing.md"))).toBe(true));
    expect(store.repairs()).toHaveLength(1);
    vault.remove("Invalid.md"); vault.emitDelete("Invalid.md");
    expect(store.status.get().metadataAttention).toBe(0);
    expect(store.repairs()).toEqual([]);
    store.dispose();
  });
});
