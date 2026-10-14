import { expect, it } from "vitest";
import { asVaultPath, createObservable, type ContentHash, type PolicySnapshot } from "../core";
import { FakeCorpus, FakeMetadata } from "../../test/fakes";
import { createAccessRuntime } from "./access-runtime";
import { createExclusionPolicy } from "./exclusion";

it("invalidates synchronously, blocks dirty sources until metadata refresh, and disposes listeners", () => {
  const corpus = new FakeCorpus([{ path: "Public.md", text: "public" }]);
  const metadata = new FakeMetadata();
  const path = asVaultPath("Public.md");
  metadata.set(path, { tags: [], frontmatter: {}, headings: [] });
  const hash = "a".repeat(64) as ContentHash;
  const policy: PolicySnapshot = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "allow", "external-client": "deny" }, rules: [] } };
  const controls = createObservable(0);
  const runtime = createAccessRuntime({ vault: corpus.vault, metadata,
    paths: { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") },
    policy: () => policy, subscribePolicy: (cb) => controls.subscribe(cb),
    getDoc: (p) => corpus.docs.get(p) ?? null, getFrontmatter: (p) => corpus.asDeps().getFrontmatter(p), listDocs: () => [...corpus.docs.values()],
    exclusion: createExclusionPolicy({ folders: [], tags: ["private"], frontmatterKey: "vault-synapse" }),
  });
  const open = () => runtime.open({ recipient: "remote-model", purpose: "chat", policyHash: hash }, "evidence");
  const initial = open();
  expect(initial.allows(path)).toBe(true);
  expect(runtime.internalCount()).toBe(1);
  corpus.vault.emitModify(path);
  expect(initial.current()).toBe(false);
  expect(open().allows(path)).toBe(false);
  metadata.set(path, { tags: ["private"], frontmatter: {}, headings: [] });
  metadata.emitChanged(path);
  expect(open().allows(path)).toBe(false);
  expect(runtime.internalCount()).toBe(0);
  metadata.set(path, { tags: [], frontmatter: {}, headings: [] });
  metadata.emitChanged(path);
  expect(open().allows(path)).toBe(true);
  metadata.set(path, { tags: [], frontmatter: { visibility: "updated" }, headings: [] });
  metadata.emitChanged(path);
  expect(open().allows(path)).toBe(false); // New metadata + stale corpus fields.
  corpus.addNote({ path, text: "updated", frontmatter: { visibility: "updated" } });
  expect(open().allows(path)).toBe(true);
  const prior = open(); controls.set(1);
  expect(prior.current()).toBe(false);
  runtime.dispose();
  expect(open().current()).toBe(false);
  const after = runtime.changes.get();
  corpus.vault.emitModify(path); metadata.emitChanged(path); controls.set(2);
  expect(runtime.changes.get()).toBe(after);
});
