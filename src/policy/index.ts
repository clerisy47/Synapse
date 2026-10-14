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
export { evaluateAccessContract } from "./recipient-contract";
export type { AccessContractRequest, AccessDecision } from "./recipient-contract";
