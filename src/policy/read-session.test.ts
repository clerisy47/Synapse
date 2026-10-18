import { describe, expect, it } from "vitest";
import { asVaultPath, type ContentHash, type PolicySnapshot } from "../core";
import { FakeCorpus } from "../../test/fakes";
import { createReadSession } from "./read-session";

const hash = "a".repeat(64) as ContentHash;
const paths = { instructions: asVaultPath("Synapse/Instructions.md"), research: asVaultPath("Research.md") };
function fixture(projection: "raw-tools" | "evidence" = "evidence") {
  const corpus = new FakeCorpus([{ path: "Public.md", text: "Public confidential", tags: ["work"], frontmatter: { share: true } }]);
  let version = "v1";
  let policy: PolicySnapshot | null = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "allow", "external-client": "deny" }, rules: [
    { id: "mask", recipient: "remote-model", operation: "read", effect: "mask", selector: {}, masks: [{ kind: "remove-field", field: "path" }, { kind: "replace-literal", from: "confidential", to: "safe" }] },
  ] } };
  const deps = corpus.asDeps();
  const session = createReadSession({ context: { recipient: "remote-model", purpose: "chat", policyHash: hash }, policy: () => policy, version: () => version, paths, getDoc: (path) => deps.getDoc(path), getFrontmatter: (path) => deps.getFrontmatter(path), projection, listDocs: () => deps.listDocs() });
  const path = asVaultPath("Public.md");
  const excerpt = { ref: { path, kind: "note" as const }, text: "Public confidential", locator: { start: 0, end: 19 }, textHash: "h", sourceMtime: 0 };
  return { session, path, excerpt, change: () => { version = "v2"; }, unavailable: () => { policy = null; } };
}

describe("recipient read sessions", () => {
  it("projects evidence while retaining private original references", () => {
    const { session, path, excerpt } = fixture();
    session.remember(path, excerpt.text);
    expect(session.project(excerpt)).toEqual({ title: "", text: " safe" });
    expect(session.sanitize("Public confidential")).toBe(" safe");
    expect(excerpt.ref.path).toBe("Public.md");
  });
  it("denies raw path-bearing representations that cannot enforce masks", () => {
    const { session, path } = fixture("raw-tools");
    expect(session.allows(path)).toBe(false);
  });
  it.each(["change", "unavailable"] as const)("discards stale projections after %s", (operation) => {
    const f = fixture(); f.session.remember(f.path, f.excerpt.text); f[operation]();
    expect(f.session.current()).toBe(false);
    expect(f.session.allows(f.path)).toBe(false);
    expect(f.session.project(f.excerpt)).toBeNull();
    expect(f.session.sanitize("confidential")).toBe("");
  });
  it("refuses source-less or changed excerpt projections", () => {
    const { session, path, excerpt } = fixture();
    expect(session.project(excerpt)).toBeNull();
    session.remember(path, "different source");
    expect(session.project(excerpt)).toBeNull();
  });
});

it("gives an external query client a pathless projection only within its trusted capability", () => {
  const corpus = new FakeCorpus([{ path: "Public.md", text: "Public secret" }]);
  const raw = corpus.asDeps();
  const policy: PolicySnapshot = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "deny", "external-client": "allow" }, rules: [
    { id: "external-mask", recipient: "external-client", operation: "read", effect: "mask", selector: {}, masks: [{ kind: "remove-field", field: "path" }, { kind: "replace-literal", from: "secret", to: "safe" }] },
  ] } };
  const open = (capabilities: readonly ("query-vault" | "submit-research")[]) => createReadSession({
    context: { recipient: "external-client", purpose: "query", policyHash: hash, clientId: "paired", capabilities }, policy: () => policy, version: () => "v1", projection: "evidence", paths,
    getDoc: (p) => raw.getDoc(p), listDocs: () => raw.listDocs(), getFrontmatter: (p) => raw.getFrontmatter(p),
  });
  const path = asVaultPath("Public.md");
  const session = open(["query-vault"]);
  session.remember(path, "Public secret");
  const view = session.project({ ref: { path, kind: "note" }, text: "Public secret", locator: { start: 0, end: 13 }, textHash: "h", sourceMtime: 0 });
  expect(view).toEqual({ title: "", text: " safe" });
  expect(JSON.stringify(view)).not.toMatch(/Public|secret|path/);
  expect(open(["submit-research"]).allows(path)).toBe(false);
});
