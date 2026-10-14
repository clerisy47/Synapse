import { describe, expect, it, vi } from "vitest";
import { contentHash, validateControlPaths } from "../core";
import { DEFAULT_CONTROL_PATHS } from "../constants";
import { FakeVault } from "../../test/fakes";
import { createControlStore, CONTROL_STARTERS, routeDaily } from "./index";

const paths = validateControlPaths(DEFAULT_CONTROL_PATHS);
if (!paths.ok) throw new Error("fixture paths");
const controlPaths = paths.value;
function fixture() {
  const vault = new FakeVault();
  vault.addNote({ path: controlPaths.instructions, text: CONTROL_STARTERS.instructions });
  vault.addNote({ path: controlPaths.security, text: CONTROL_STARTERS.security });
  const store = createControlStore({ vault, paths: controlPaths, starters: CONTROL_STARTERS });
  return { vault, store };
}

describe("privileged editable controls", () => {
  it("loads exact text hashes and prose without modifying existing files", async () => {
    const { vault, store } = fixture();
    await store.reload();
    const state = store.status.get();
    expect(state.security.status).toBe("ready");
    expect(state.instructions.status).toBe("ready");
    if (state.instructions.status !== "ready") throw new Error("fixture");
    expect(state.instructions.snapshot.hash).toBe((await contentHash(CONTROL_STARTERS.instructions) as { value: string }).value);
    expect(state.instructions.snapshot.prose).toContain("# Synapse instructions");
    expect(Object.isFrozen(state.instructions.snapshot.routing.daily)).toBe(true);
    expect(await store.proposeSetup()).toEqual([]);
    expect(await vault.readText(controlPaths.security)).toBe(CONTROL_STARTERS.security);
    store.dispose();
  });

  it.each([
    "no frontmatter", "---\nversion: 1\nversion: 1\n---\nprivate text",
    "---\na: &a [1]\nb: *a\n---\n", "---\nversion: !custom 1\n---\n",
    CONTROL_STARTERS.security.replace('"version": 1', '"version": 2'),
    CONTROL_STARTERS.security.replace('"rules": []', '"rules": "private malformed data"'),
    "---\n{broken\n---\n",
  ])("fails closed with redacted state for malformed security", async (text) => {
    const { vault, store } = fixture();
    vault.addNote({ path: controlPaths.security, text });
    await store.reload();
    expect(store.status.get().security).toEqual({ status: "invalid" });
    store.dispose();
  });

  it("accepts ordinary YAML and CRLF while retaining exact prose", async () => {
    const { vault, store } = fixture();
    vault.addNote({ path: controlPaths.security, text: '---\r\nversion: 1\r\ndefaults:\r\n  internal: allow\r\n  remote-model: deny\r\n  external-client: deny\r\nrules: []\r\n---\r\nprose' });
    await store.reload();
    expect(store.status.get().security.status).toBe("ready");
    store.dispose();
  });

  it("proposes only missing exact starters, never an existing case alias", async () => {
    const vault = new FakeVault();
    vault.addNote({ path: "synapse/security.md", text: "existing" });
    const store = createControlStore({ vault, paths: controlPaths, starters: CONTROL_STARTERS });
    await store.reload();
    expect(store.status.get().security.status).toBe("invalid");
    expect(store.status.get().instructions.status).toBe("missing");
    expect(await store.proposeSetup()).toEqual([{ path: controlPaths.instructions, before: "", after: CONTROL_STARTERS.instructions, expectedAbsent: true }]);
    store.dispose();
  });

  it("invalidates immediately on edits, ignores stale completions, and stops on disposal", async () => {
    const { vault, store } = fixture();
    await store.reload();
    const read = vault.readText.bind(vault);
    let release!: (text: string) => void;
    vi.spyOn(vault, "readText").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = store.reload();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(store.status.get().instructions.status).toBe("loading");
    vault.addNote({ path: controlPaths.instructions, text: "invalid edited instructions" });
    vault.emitModify(controlPaths.instructions);
    await vi.waitFor(() => expect(store.status.get().instructions.status).toBe("invalid"));
    release(await read(controlPaths.security));
    await pending;
    expect(store.status.get().instructions.status).toBe("invalid");
    store.dispose();
    const revision = store.status.get().revision;
    vault.emitCreate(controlPaths.instructions);
    await store.reload();
    expect(store.status.get().revision).toBe(revision);
  });

  it("invalidates on deletion and rename and refreshes prose-only hashes", async () => {
    const { vault, store } = fixture();
    await store.reload();
    const previous = store.status.get().security.snapshot?.hash;
    vault.addNote({ path: controlPaths.security, text: CONTROL_STARTERS.security + "\nEdited prose" });
    vault.emitModify(controlPaths.security);
    await vi.waitFor(() => expect(store.status.get().security.snapshot?.hash).not.toBe(previous));
    await vi.waitFor(() => expect(store.status.get().security.status).toBe("ready"));
    vault.remove(controlPaths.security);
    vault.emitRename(controlPaths.security, "Other.md");
    expect(store.status.get().security.status).toBe("loading");
    await vi.waitFor(() => expect(store.status.get().security.status).toBe("missing"));
    store.dispose();
  });

  it("does not expose I/O exception details", async () => {
    const { vault, store } = fixture();
    vi.spyOn(vault, "readText").mockRejectedValue(new Error("secret path and content"));
    await store.reload();
    expect(store.status.get().security).toEqual({ status: "unavailable" });
    store.dispose();
  });

  it("rejects control destinations and conflicting file names", async () => {
    const { vault, store } = fixture();
    vault.addNote({ path: controlPaths.instructions, text: CONTROL_STARTERS.instructions.replace('"destinations": []', '"destinations": [{"id":"restricted","path":"Research.md"}]') });
    vault.addNote({ path: "Synapse/SECURITY.md", text: CONTROL_STARTERS.security });
    await store.reload();
    expect(store.status.get().instructions.status).toBe("invalid");
    expect(store.status.get().security.status).toBe("invalid");
    store.dispose();
  });
});

describe("daily calendar routing", () => {
  async function routing(zone: string) {
    const { vault, store } = fixture();
    vault.addNote({ path: controlPaths.instructions, text: CONTROL_STARTERS.instructions.replace('"UTC"', JSON.stringify(zone)) });
    await store.reload();
    const snapshot = store.status.get().instructions.snapshot;
    if (!snapshot) throw new Error("fixture");
    store.dispose();
    return snapshot.routing;
  }
  it("crosses midnight in configured timezone", async () => {
    const settings = await routing("Asia/Kathmandu");
    expect(routeDaily(settings, "today", Date.parse("2026-10-14T18:14:59Z"))).toMatchObject({ value: "Daily/2026-10-14.md" });
    expect(routeDaily(settings, "today", Date.parse("2026-10-14T18:15:00Z"))).toMatchObject({ value: "Daily/2026-10-15.md" });
  });
  it("shifts calendar days across DST and leap/year boundaries", async () => {
    const settings = await routing("America/New_York");
    expect(routeDaily(settings, "yesterday", Date.parse("2026-03-09T04:30:00Z"))).toMatchObject({ value: "Daily/2026-03-08.md" });
    expect(routeDaily(settings, "tomorrow", Date.parse("2026-12-31T17:00:00Z"))).toMatchObject({ value: "Daily/2027-01-01.md" });
    expect(routeDaily(settings, "2024-02-29", 0)).toMatchObject({ value: "Daily/2024-02-29.md" });
    expect(routeDaily(settings, Date.parse("2026-10-15T02:00:00Z"), 0)).toMatchObject({ value: "Daily/2026-10-14.md" });
  });
  it.each(["10/11/2026", "next Friday", "2026-02-29", "0000-01-01", "2026-10-14T12:00:00", "today please", Number.NaN])("rejects ambiguous/invalid inputs", async (date) => {
    expect(routeDaily(await routing("UTC"), date, 0).ok).toBe(false);
  });
});
