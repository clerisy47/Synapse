import { expect, it } from "vitest";
import { asVaultPath, type ContentHash, type PolicySnapshot } from "../core";
import { evaluateAccessContract, evaluateResearchInput, type AccessContractRequest } from "./index";

const hash = "a".repeat(64) as ContentHash;
const policy: PolicySnapshot = { version: 1, hash, rules: { version: 1, defaults: { internal: "allow", "remote-model": "allow", "external-client": "allow" }, rules: [] } };
function request(path: string): AccessContractRequest {
  return { context: { recipient: "remote-model", purpose: "research", policyHash: hash }, operation: "read", path: asVaultPath(path), excluded: false, tags: [], frontmatter: {}, maskingSupported: true,
    controlPaths: { instructions: asVaultPath("Synapse/Instructions.md"), security: asVaultPath("Synapse/Security.md"), research: asVaultPath("Research.md") } };
}
it.each(["Research.md", "Synapse/Instructions.md"])("keeps privileged %s unavailable to ordinary reads", (path) => {
  expect(evaluateResearchInput(policy, request(path))).toEqual({ effect: "allow" });
  expect(evaluateAccessContract(policy, request(path)).effect).toBe("deny");
});
it("denies security files, ordinary notes, wrong purposes, clients and write operations", () => {
  const base = request("Research.md");
  for (const input of [request("Synapse/Security.md"), request("Notes/Topic.md"), { ...base, context: { recipient: "remote-model", purpose: "chat", policyHash: hash } as const },
    { ...base, context: { recipient: "external-client", purpose: "query", policyHash: hash, clientId: "client", capabilities: ["query-vault"] } as const },
    { ...base, operation: "update" as const }]) expect(evaluateResearchInput(policy, input).effect).toBe("deny");
});
it("preserves exclusions, current-policy checks, deny precedence and missing metadata", () => {
  const base = request("Research.md");
  for (const input of [{ ...base, excluded: true }, { ...base, tags: null }, { ...base, frontmatter: null }, { ...base, context: { ...base.context, policyHash: "b".repeat(64) as ContentHash } }]) expect(evaluateResearchInput(policy, input).effect).toBe("deny");
  expect(evaluateResearchInput(null, base).effect).toBe("deny");
  const denied: PolicySnapshot = { ...policy, rules: { ...policy.rules, rules: [ { id: "allow", recipient: "remote-model", operation: "read", effect: "allow", selector: {} }, { id: "deny", recipient: "remote-model", operation: "read", effect: "deny", selector: {} } ] } };
  expect(evaluateResearchInput(denied, base).effect).toBe("deny");
});
