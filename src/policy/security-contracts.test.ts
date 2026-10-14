import { describe, expect, it } from "vitest";
import { asVaultPath, type ContentHash, type PolicySnapshot, type SecurityRule } from "../core";
import { evaluateAccessContract, parseSecurityRules, type AccessContractRequest } from "./index";

const hash = "a".repeat(64) as ContentHash;
const starter = { version: 1, defaults: { internal: "allow", "remote-model": "deny", "external-client": "deny" }, rules: [] };
const grant: SecurityRule = { id: "grant", recipient: "remote-model", operation: "read", effect: "allow", selector: { folder: "Projects" } };
function snapshot(rules: readonly SecurityRule[] = []): PolicySnapshot {
  const parsed = parseSecurityRules({ ...starter, rules });
  if (!parsed.ok) throw new Error("Invalid fixture");
  return { version: 1, hash, rules: parsed.value };
}
function request(overrides: Partial<AccessContractRequest> = {}): AccessContractRequest {
  return { context: { recipient: "internal", purpose: "search", policyHash: hash }, operation: "read", path: asVaultPath("Projects/One.md"), excluded: false, tags: [], frontmatter: {}, controlPaths: { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") }, maskingSupported: true, ...overrides };
}
const remote = () => request({ context: { recipient: "remote-model", purpose: "chat", policyHash: hash } });

describe("strict security frontmatter", () => {
  it("accepts safe defaults and canonical structured selectors", () => {
    const result = parseSecurityRules({ ...starter, rules: [{ ...grant, selector: { folder: "Projects\\Client", tag: "#client/x", frontmatter: { key: "share", value: true } } }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rules[0].selector).toEqual({ folder: "Projects/Client", tag: "client/x", frontmatter: { key: "share", value: true } });
  });
  it.each([
    null, { ...starter, version: 2 }, { ...starter, proseGrantsAccess: true }, { ...starter, defaults: { internal: "allow" } },
    { ...starter, rules: [grant, grant] },
    { ...starter, rules: [{ ...grant, selector: { folder: "../Private" } }] },
    { ...starter, rules: [{ ...grant, selector: { regex: ".*" } }] },
    { ...starter, rules: [{ ...grant, selector: { tag: "a//b" } }] },
    { ...starter, rules: [{ ...grant, selector: { tag: "a/" } }] },
    { ...starter, rules: [{ ...grant, selector: { frontmatter: { key: "share", value: {} } } }] },
    { ...starter, rules: [{ ...grant, effect: "mask" }] },
    { ...starter, rules: [{ ...grant, masks: [{ kind: "replace-literal", from: "x", to: "y" }] }] },
    { ...starter, rules: [{ ...grant, effect: "mask", masks: [{ kind: "replace-regex", regex: ".*", to: "" }] }] },
    { ...starter, rules: [{ ...grant, effect: "mask", masks: [{ kind: "replace-literal", from: "", to: "x" }] }] },
    { ...starter, rules: [{ ...grant, operation: "update" }] },
    { ...starter, rules: [{ ...grant, recipient: "external-client", operation: "create" }] },
  ])("rejects malformed or unsupported contracts %#", (input) => expect(parseSecurityRules(input).ok).toBe(false));
  it("reports only issue codes and field locations", () => {
    const result = parseSecurityRules({ ...starter, rules: [{ ...grant, selector: { folder: "secret-note/../private" } }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.detail).toEqual({ issueCode: "INVALID_VAULT_PATH", field: "rules.0.selector.folder" });
      expect(JSON.stringify(result.error)).not.toContain("secret-note");
    }
  });
});

describe("recipient policy contract", () => {
  it("allows internal reads without granting remote, external, or write access", () => {
    const policy = snapshot();
    expect(evaluateAccessContract(policy, request())).toEqual({ effect: "allow" });
    expect(evaluateAccessContract(policy, remote()).effect).toBe("deny");
    expect(evaluateAccessContract(policy, request({ context: { recipient: "external-client", purpose: "query", policyHash: hash, clientId: "paired", capabilities: ["query-vault"] } })).effect).toBe("deny");
    expect(evaluateAccessContract(policy, request({ operation: "update", context: { recipient: "internal", purpose: "apply", policyHash: hash } })).effect).toBe("deny");
  });
  it("requires policy availability, current snapshots and parsed metadata", () => {
    expect(evaluateAccessContract(null, request()).effect).toBe("deny");
    expect(evaluateAccessContract(snapshot(), request({ context: { recipient: "internal", purpose: "search", policyHash: "stale" as ContentHash } })).effect).toBe("deny");
    for (const overrides of [{ tags: null }, { frontmatter: null }, { excluded: true }]) expect(evaluateAccessContract(snapshot(), request(overrides)).effect).toBe("deny");
  });
  it("denies control files and inbox in ordinary retrieval", () => {
    for (const path of [request().controlPaths.instructions, request().controlPaths.security, request().controlPaths.research]) expect(evaluateAccessContract(snapshot(), request({ path })).effect).toBe("deny");
  });
  it("deny wins regardless of rule order and masks do not grant", () => {
    const deny: SecurityRule = { ...grant, id: "deny", effect: "deny" };
    for (const rules of [[grant, deny], [deny, grant]]) expect(evaluateAccessContract(snapshot(rules), remote()).effect).toBe("deny");
    const mask: SecurityRule = { ...grant, id: "mask", effect: "mask", masks: [{ kind: "remove-field", field: "path" }] };
    expect(evaluateAccessContract(snapshot([mask]), remote()).effect).toBe("deny");
    expect(evaluateAccessContract(snapshot([grant, mask]), remote())).toEqual({ effect: "mask", masks: mask.masks });
    expect(evaluateAccessContract(snapshot([grant, mask]), { ...remote(), maskingSupported: false })).toEqual({ effect: "deny", reason: "mask-unenforceable" });
  });
  it("matches folder and nested-tag boundaries and requires all selectors", () => {
    const policy = snapshot([{ ...grant, selector: { folder: "Projects", tag: "approved", frontmatter: { key: "share", value: true } } }]);
    expect(evaluateAccessContract(policy, { ...remote(), tags: ["#approved/client"], frontmatter: { share: true } }).effect).toBe("allow");
    for (const overrides of [{ path: asVaultPath("ProjectsOther/One.md") }, { tags: ["approvedish"] }, { frontmatter: { share: "true" } }, { frontmatter: Object.create({ share: true }) as Record<string, unknown> }]) expect(evaluateAccessContract(policy, { ...remote(), tags: ["approved"], frontmatter: { share: true }, ...overrides }).effect).toBe("deny");
  });
  it("retains replacement order and unions field removals in a mask plan", () => {
    const maskOne: SecurityRule = { ...grant, id: "first", effect: "mask", masks: [{ kind: "remove-field", field: "title" }, { kind: "replace-literal", from: "Client One", to: "[CLIENT]" }] };
    const maskTwo: SecurityRule = { ...grant, id: "second", effect: "mask", masks: [{ kind: "remove-field", field: "path" }, { kind: "replace-literal", from: "Client Two", to: "[CLIENT]" }] };
    expect(evaluateAccessContract(snapshot([grant, maskOne, maskTwo]), remote())).toEqual({ effect: "mask", masks: [...maskOne.masks!, ...maskTwo.masks!] });
  });
  it("intersects client scopes with policy and restricts append to the configured inbox", () => {
    const query: SecurityRule = { ...grant, recipient: "external-client" };
    const policy = snapshot([query, { id: "inbox", recipient: "external-client", operation: "append-research", effect: "allow", selector: {} }]);
    const context = { recipient: "external-client", purpose: "query", policyHash: hash, clientId: "paired", capabilities: ["query-vault"] } as const;
    expect(evaluateAccessContract(policy, request({ context })).effect).toBe("allow");
    expect(evaluateAccessContract(policy, request({ context: { ...context, capabilities: ["submit-research"] } })).effect).toBe("deny");
    expect(evaluateAccessContract(policy, request({ context: { ...context, clientId: "" } })).effect).toBe("deny");
    const submit = { ...context, purpose: "submit", capabilities: ["submit-research"] } as const;
    expect(evaluateAccessContract(policy, request({ context: submit, operation: "append-research", path: asVaultPath("Research.md") })).effect).toBe("allow");
    expect(evaluateAccessContract(policy, request({ context: submit, operation: "append-research" })).effect).toBe("deny");
    expect(evaluateAccessContract(policy, request({ context: submit, operation: "update" })).effect).toBe("deny");
  });
  it("requires explicit write grants and the local apply purpose", () => {
    const policy = snapshot([{ id: "write", recipient: "internal", operation: "update", effect: "allow", selector: { folder: "Projects" } }]);
    expect(evaluateAccessContract(policy, request({ operation: "update" })).effect).toBe("deny");
    expect(evaluateAccessContract(policy, request({ operation: "update", context: { recipient: "internal", purpose: "apply", policyHash: hash } })).effect).toBe("allow");
  });
});
