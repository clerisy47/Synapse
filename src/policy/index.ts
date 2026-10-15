/**
 * policy — EndpointPolicy + ExclusionPolicy (DESIGN §3).
 */

export type {
  EndpointBlockReason,
  EndpointCheckResult,
  EndpointPolicy,
  EndpointPolicyOptions,
} from "./endpoint";
export { createEndpointPolicy } from "./endpoint";

export type {
  ExclusionDecideOptions,
  ExclusionDecision,
  ExclusionPolicy,
  ExclusionRules,
} from "./exclusion";
export { createExclusionPolicy } from "./exclusion";

export { AccessContextSchema, SecurityRulesSchema, parseSecurityRules } from "./security-contracts";
export { evaluateAccessContract, evaluateResearchInput } from "./recipient-contract";
export type { AccessContractRequest, AccessDecision } from "./recipient-contract";

export { replaceLiterals, projectDisclosure } from "./disclosure";
export type { DisclosureExcerpt } from "./disclosure";
export { createReadSession, intersectReadSessions } from "./read-session";
export type { ReadSession, ReadSessionOptions } from "./read-session";
export { createAccessRuntime } from "./access-runtime";
export type { AccessRuntime } from "./access-runtime";
export { guardNavigation } from "./navigation";
