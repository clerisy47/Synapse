import type { AccessContext, AccessOperation, ControlPaths, MaskAction, PolicySelector, PolicySnapshot, VaultPath } from "../core";

export type AccessDecision =
  | { readonly effect: "deny"; readonly reason: "policy-unavailable" | "stale-policy" | "excluded" | "control-file" | "metadata-unavailable" | "capability" | "rule" | "mask-unenforceable" }
  | { readonly effect: "allow" }
  | { readonly effect: "mask"; readonly masks: readonly MaskAction[] };

export interface AccessContractRequest {
  readonly context: AccessContext;
  readonly operation: AccessOperation;
  readonly path: VaultPath;
  readonly excluded: boolean;
  readonly tags: readonly string[] | null;
  readonly frontmatter: Readonly<Record<string, unknown>> | null;
  readonly controlPaths: ControlPaths;
  /** False when the downstream representation cannot enforce every configured mask. */
  readonly maskingSupported: boolean;
}

function matches(selector: PolicySelector, request: AccessContractRequest): boolean {
  const { folder, tag, frontmatter } = selector;
  return (folder === undefined || request.path.startsWith(`${folder}/`))
    && (tag === undefined || request.tags!.some((value) => {
      const normalized = value.replace(/^#/, "");
      return normalized === tag || normalized.startsWith(`${tag}/`);
    }))
    && (frontmatter === undefined || (Object.prototype.hasOwnProperty.call(request.frontmatter!, frontmatter.key) && request.frontmatter![frontmatter.key] === frontmatter.value));
}

/** Shared deterministic decision used by runtime read sessions and later write gates. */
export function evaluateAccessContract(policy: PolicySnapshot | null, request: AccessContractRequest): AccessDecision {
  return evaluate(policy, request, false);
}

/** Explicit selected-research/style disclosure only; never used by retrieval/tools.
 * Caller still supplies user exclusion and current metadata. Security.md stays private. */
export function evaluateResearchInput(policy: PolicySnapshot | null, request: AccessContractRequest): AccessDecision {
  const privileged = request.operation === "read" && request.context.purpose === "research"
    && [request.controlPaths.research, request.controlPaths.instructions].includes(request.path);
  if (!privileged) return { effect: "deny", reason: "control-file" };
  return evaluate(policy, request, true);
}

function evaluate(policy: PolicySnapshot | null, request: AccessContractRequest, privileged: boolean): AccessDecision {
  const deny = (reason: Extract<AccessDecision, { effect: "deny" }>["reason"]): AccessDecision => ({ effect: "deny", reason });
  if (policy === null) return deny("policy-unavailable");
  if (request.context.policyHash !== policy.hash) return deny("stale-policy");
  const inboxAppend = request.operation === "append-research" && request.context.recipient === "external-client" && request.path === request.controlPaths.research;
  if (request.operation === "append-research" && !inboxAppend) return deny("capability");
  if (request.excluded) return deny("excluded");
  if (!privileged && !inboxAppend && [request.controlPaths.instructions, request.controlPaths.security, request.controlPaths.research].some((path) => path.toLowerCase() === request.path.toLowerCase())) return deny("control-file");
  if (request.tags === null || request.frontmatter === null) return deny("metadata-unavailable");
  const { context, operation } = request;
  if (context.recipient === "remote-model" && operation !== "read") return deny("capability");
  if (context.recipient === "internal" && (operation === "append-research" || (operation !== "read" && context.purpose !== "apply"))) return deny("capability");
  if (context.recipient === "external-client") {
    if (!context.clientId || (operation === "read" ? context.purpose !== "query" || !context.capabilities.includes("query-vault") : operation === "append-research" ? context.purpose !== "submit" || !context.capabilities.includes("submit-research") : true)) return deny("capability");

  }
  const matching = policy.rules.rules.filter((rule) => rule.recipient === context.recipient && rule.operation === operation && matches(rule.selector, request));
  if (matching.some((rule) => rule.effect === "deny")) return deny("rule");
  const allowed = matching.some((rule) => rule.effect === "allow") || (operation === "read" && policy.rules.defaults[context.recipient] === "allow");
  if (!allowed) return deny("rule");
  const masks = matching.flatMap((rule) => rule.effect === "mask" ? [...rule.masks!] : []);
  if (masks.length > 0 && !request.maskingSupported) return deny("mask-unenforceable");
  return masks.length > 0 ? { effect: "mask", masks } : { effect: "allow" };
}
