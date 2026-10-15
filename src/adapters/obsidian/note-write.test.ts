import { describe, expect, it, vi } from "vitest";
import { asVaultPath, type NoteWriteRequest, type ProposedChange } from "../../core";
import { createObsidianNoteWriter, createObsidianResearchAppender, type NoteWriteSurface } from "./note-write";

function fixture() {
  const files = new Map([["Topic.md", "before"]]);
  const editors: { path: string; text: string | null }[] = [];
  let duringProcess = () => {};
  let duringCreate = () => {};
  const surface: NoteWriteSurface = {
    entries: () => [...files.keys()].map((path) => ({ path, markdown: path.endsWith(".md") })),
    editors: () => editors,
    exists: async (path) => files.has(path),
    read: async (path) => files.get(path)!,
    process: vi.fn(async (path: string, update: (text: string) => string) => { duringProcess(); files.set(path, update(files.get(path)!)); }),
    create: vi.fn(async (path: string, text: string) => { duringCreate(); if (files.has(path)) throw Error("exists"); files.set(path, text); }),
  };
  const abort = new AbortController(); let current = true;
  const request: NoteWriteRequest = {
    change: { path: asVaultPath("Topic.md"), operation: "update", before: "before", after: "after", target: { exists: true, hash: "x" }, destinationId: "D1", evidenceIds: ["E1"] } as unknown as ProposedChange,
    paths: { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") },
    signal: abort.signal, current: () => current, revalidate: vi.fn(async () => true), willCommit: vi.fn(), editorSnapshots: () => [],
  };
  return { writer: createObsidianNoteWriter(surface), files, editors, surface, request, abort, stale: () => { current = false; },
    duringProcess(fn: () => void) { duringProcess = fn; }, duringCreate(fn: () => void) { duringCreate = fn; } };
}
describe("restricted note write adapter", () => {
  it("updates through compare-and-process and creates only absent Markdown", async () => {
    const f = fixture(); expect((await f.writer.apply(f.request)).ok).toBe(true);
    expect(f.files.get("Topic.md")).toBe("after"); expect(f.surface.process).toHaveBeenCalledOnce();
    expect((await f.writer.apply({ ...f.request, change: { ...f.request.change, path: asVaultPath("New.md"), operation: "create", target: { exists: false }, before: "" } })).ok).toBe(true);
    expect(f.files.get("New.md")).toBe("after");
  });
  it.each(["Research.md", "research.md", "Synapse/Security.md", "Synapse/Instructions.md", "../Topic.md", "Topic.txt", ".obsidian/x.md", "Topic\\Child.md"])("rejects forbidden target %s", async (path) => {
    const f = fixture(); expect((await f.writer.apply({ ...f.request, change: { ...f.request.change, path: asVaultPath(path) } })).ok).toBe(false);
    expect(f.surface.process).not.toHaveBeenCalled(); expect(f.surface.create).not.toHaveBeenCalled();
  });
  it.each(["disk", "background-editor", "unverifiable-editor", "case-alias", "cancel", "policy"])("refuses %s changed while waiting for the atomic callback", async (kind) => {
    const f = fixture(); f.duringProcess(() => {
      if (kind === "disk") f.files.set("Topic.md", "concurrent edit");
      if (kind === "background-editor") f.editors.push({ path: "Topic.md", text: "dirty" });
      if (kind === "unverifiable-editor") f.editors.push({ path: "Topic.md", text: null });
      if (kind === "case-alias") f.files.set("topic.md", "alias");
      if (kind === "cancel") f.abort.abort();
      if (kind === "policy") f.stale();
    });
    expect((await f.writer.apply(f.request)).ok).toBe(false);
    expect(f.files.get("Topic.md")).toBe(kind === "disk" ? "concurrent edit" : "before");
  });
  it("does not overwrite a concurrent creation", async () => {
    const f = fixture(); f.duringCreate(() => f.files.set("New.md", "user content"));
    expect((await f.writer.apply({ ...f.request, change: { ...f.request.change, path: asVaultPath("New.md"), operation: "create", target: { exists: false }, before: "" } })).ok).toBe(false);
    expect(f.files.get("New.md")).toBe("user content");
  });
  it("refuses when authorization fails and burns no writes", async () => {
    const f = fixture(); f.request.revalidate = async () => false;
    expect((await f.writer.apply(f.request)).ok).toBe(false); expect(f.surface.process).not.toHaveBeenCalled();
  });
  it("serializes access by refusing a second in-flight call", async () => {
    const f = fixture(); let release!: () => void;
    f.request.revalidate = () => new Promise((resolve) => { release = () => resolve(true); });
    const first = f.writer.apply(f.request);
    expect((await f.writer.apply(f.request)).ok).toBe(false); f.abort.abort(); release();
    expect((await first).ok).toBe(false);
  });
});

it("checks background source and control editor guards at the atomic boundary", async () => {
  const f = fixture();
  f.request.editorSnapshots = () => [{ path: "Research.md", text: "research" }, { path: "Synapse/Security.md", text: "rules" }];
  f.duringProcess(() => f.editors.push({ path: "Synapse/Security.md", text: "unsaved policy" }));
  expect((await f.writer.apply(f.request)).ok).toBe(false); expect(f.files.get("Topic.md")).toBe("before");
});
it("separately scopes append to the configured inbox and rechecks the bound gate", async () => {
  const f = fixture(); f.files.set("Research.md", "inbox"); let authorized = true;
  const appender = createObsidianResearchAppender(f.surface, f.request.paths, { revalidate: async () => authorized, current: () => authorized });
  expect((await appender.append({ before: "inbox", text: "\nnew research", signal: f.abort.signal })).ok).toBe(true);
  expect(f.files.get("Research.md")).toBe("inbox\nnew research"); expect(f.files.get("Topic.md")).toBe("before");
  authorized = false;
  expect((await appender.append({ before: "inbox\nnew research", text: "\nblocked", signal: f.abort.signal })).ok).toBe(false);
  expect(f.files.get("Research.md")).toBe("inbox\nnew research");
});
it("does not claim a host rejection after submission proves that nothing was written", async () => {
  const f = fixture();
  f.surface.process = async (path, update) => { f.files.set(path, update(f.files.get(path)!)); throw Error("host failure"); };
  const result = await f.writer.apply(f.request);
  expect(result.ok).toBe(false); if (result.ok) throw Error("expected refusal");
  expect(result.error.detail?.issueCode).toBe("WRITE_OUTCOME_UNKNOWN"); expect(f.files.get("Topic.md")).toBe("after");
});

it("refuses a disk-only destination that is absent from the host file cache", async () => {
  const f = fixture(); f.surface.exists = async () => true;
  const result = await f.writer.apply({ ...f.request, change: { ...f.request.change, path: asVaultPath("New.md"), operation: "create", target: { exists: false }, before: "" } });
  expect(result.ok).toBe(false); expect(f.surface.create).not.toHaveBeenCalled();
});
