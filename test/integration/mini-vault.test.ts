import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { asVaultPath, contentHash, type ApprovalBinding, type NoteWriteRequest, type VaultPort } from "../../src/core";
import { createRecoveryJournal } from "../../src/changes";
import { MemoryStorage } from "../fakes";
import { createObsidianNoteWriter, createObsidianResearchAppender, type NoteWriteSurface } from "../../src/adapters/obsidian";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  // Disposable copies live inside the project; committed fixtures never change.
  const root = await mkdtemp(path.resolve("test/.mini-vault-run-")); roots.push(root);
  await cp(path.resolve("test/mini-vault"), root, { recursive: true });
  const file = (name: string) => {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep)) throw Error("Outside synthetic vault");
    return target;
  };
  const names = await readdir(root, { recursive: true });
  const entries = names.filter((name) => name.endsWith(".md")).map((name) => ({ path: name, markdown: true }));
  const read = (name: string) => readFile(file(name), "utf8");
  const editors: { path: string; text: string | null }[] = [];
  let beforeProcess = async () => {};
  const surface: NoteWriteSurface = {
    entries: () => entries, editors: () => editors,
    exists: async (name) => { try { await read(name); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
    read,
    // Emulates host compare-and-process for one test process, not Obsidian's locking.
    async process(name, update) { await beforeProcess(); const next = update(await read(name)); await writeFile(file(name), next); },
    async create(name, text) { await writeFile(file(name), text, { flag: "wx" }); entries.push({ path: name, markdown: true }); },
  };
  const before = await read("Topic.md");
  const hash = await contentHash(before); if (!hash.ok) throw Error("hash");
  const request: NoteWriteRequest = {
    change: { path: asVaultPath("Topic.md"), operation: "update", before, after: before + "\nReviewed synthetic observation.\n",
      target: { exists: true, hash: hash.value }, destinationId: "D1" as NoteWriteRequest["change"]["destinationId"], evidenceIds: [] },
    paths: { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") },
    signal: new AbortController().signal, current: () => true, revalidate: async () => true,
    willCommit() {}, editorSnapshots: () => [],
  };
  return { root, read, file, editors, surface, request, writer: createObsidianNoteWriter(surface), beforeProcess(fn: () => Promise<void>) { beforeProcess = fn; } };
}

it("updates and creates Markdown on disk while preserving inbox and control files", async () => {
  const f = await fixture();
  const protectedPaths = ["Research.md", "Synapse/Instructions.md", "Synapse/Security.md"];
  const before = await Promise.all(protectedPaths.map(f.read));
  expect((await f.writer.apply(f.request)).ok).toBe(true);
  expect(await f.read("Topic.md")).toBe(f.request.change.after);
  expect((await f.writer.apply({ ...f.request, change: { ...f.request.change, path: asVaultPath("New.md"), operation: "create", before: "", target: { exists: false } } })).ok).toBe(true);
  expect(await f.read("New.md")).toBe(f.request.change.after);
  expect(await Promise.all(protectedPaths.map(f.read))).toEqual(before);
});

it.each(["disk", "editor", "policy", "control-target"])("refuses %s conflicts without overwriting disk content", async (kind) => {
  const f = await fixture();
  if (kind === "disk") f.beforeProcess(() => writeFile(f.file("Topic.md"), "Concurrent synthetic edit"));
  if (kind === "editor") f.editors.push({ path: "Topic.md", text: "Unsaved synthetic edit" });
  const request = { ...f.request, revalidate: async () => kind !== "policy",
    change: { ...f.request.change, path: asVaultPath(kind === "control-target" ? "Synapse/Security.md" : "Topic.md") } };
  const security = await f.read("Synapse/Security.md");
  expect((await f.writer.apply(request)).ok).toBe(false);
  expect(await f.read("Topic.md")).toBe(kind === "disk" ? "Concurrent synthetic edit" : f.request.change.before);
  expect(await f.read("Synapse/Security.md")).toBe(security);
});

it("appends only to the scoped inbox and refuses revoked or stale submission", async () => {
  const f = await fixture(); let authorized = true;
  const appender = createObsidianResearchAppender(f.surface, f.request.paths, { current: () => authorized, revalidate: async () => authorized });
  const before = await f.read("Research.md");
  const request = { before, text: "\nSynthetic client submission.\n", signal: f.request.signal };
  expect((await appender.append(request)).ok).toBe(true);
  expect((await appender.append(request)).ok).toBe(false);
  authorized = false;
  expect((await appender.append({ ...request, before: before + request.text })).ok).toBe(false);
  expect(await f.read("Research.md")).toBe(before + request.text);
  expect(await f.read("Topic.md")).toBe(f.request.change.before);
});


it.each(["before-write", "after-write", "conflict"])("reconciles a %s interruption against the project mini vault", async (fault) => {
  const f = await fixture();
  const storage = new MemoryStorage();
  // The real disk supplies every observation; only plugin JSON storage is in memory.
  const vault: VaultPort = {
    listFiles: async () => (await readdir(f.root, { recursive: true })).filter((name) => name.endsWith(".md")).map((name) => ({ path: asVaultPath(name), kind: "note", mtime: 1, ctime: 1, size: 0 })),
    stat: async () => null, readText: f.read, onChange: () => () => {},
  };
  const hash = await contentHash(await f.read("Research.md")); if (!hash.ok) throw Error("hash");
  const binding: ApprovalBinding = { version: 1, proposalId: "mini-recovery" as ApprovalBinding["proposalId"], instructionsHash: hash.value, policyHash: hash.value,
    batch: { id: "mini-batch" as ApprovalBinding["batch"]["id"], source: f.request.paths.research, sourceHash: hash.value, selectedHash: hash.value, range: { start: 0, end: 5 }, provenance: "local" }, changes: [f.request.change] };
  const journal = createRecoveryJournal({ storage, vault, now: () => 1 });
  const started = await journal.begin(binding); if (!started.ok) throw Error("begin");
  expect((await journal.outcome(started.value, 0, "pending")).ok).toBe(true);
  if (fault !== "before-write") expect((await f.writer.apply(f.request)).ok).toBe(true);
  if (fault === "conflict") await writeFile(f.file("Topic.md"), "Concurrent synthetic edit");
  const restarted = createRecoveryJournal({ storage, vault, now: () => 1 });
  const reconciled = await restarted.reconcile();
  expect(reconciled.ok && reconciled.value[0].outcomes).toEqual([fault === "before-write" ? "unchanged" : fault === "after-write" ? "applied" : "conflicted"]);
  expect((await restarted.begin(binding)).ok).toBe(false);
  expect(await f.read("Topic.md")).toBe(fault === "before-write" ? f.request.change.before : fault === "after-write" ? f.request.change.after : "Concurrent synthetic edit");
});
