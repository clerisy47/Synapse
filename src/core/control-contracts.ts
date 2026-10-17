import type { ExcerptId, VaultPath } from "./types";

export type ContentHash = string & { readonly __brand: "ContentHash" };
export type ProposalId = string & { readonly __brand: "ProposalId" };
export type BatchId = string & { readonly __brand: "BatchId" };
export type DestinationId = string & { readonly __brand: "DestinationId" };
export type ClientCapability = "query-vault" | "submit-research";
export type AccessRecipient = "internal" | "remote-model" | "external-client";
export type AccessOperation = "read" | "create" | "update" | "append-research";

/** Constructed by trusted local services, never by parsing a model/client request. */
export type AccessContext =
  | { readonly recipient: "internal"; readonly purpose: "search" | "chat" | "research" | "apply" | "setup"; readonly policyHash: ContentHash }
  | { readonly recipient: "remote-model"; readonly purpose: "search" | "chat" | "research"; readonly policyHash: ContentHash }
  | { readonly recipient: "external-client"; readonly purpose: "query" | "submit"; readonly policyHash: ContentHash; readonly clientId: string; readonly capabilities: readonly ClientCapability[] };

export interface ControlPaths {
  readonly instructions: VaultPath;
  readonly research: VaultPath;
}

export interface PolicySelector {
  readonly folder?: string;
  readonly tag?: string;
  readonly frontmatter?: { readonly key: string; readonly value: string | number | boolean };
}

export type MaskAction =
  | { readonly kind: "remove-field"; readonly field: "title" | "path" | "tags" | "frontmatter" | "aliases" }
  | { readonly kind: "replace-literal"; readonly from: string; readonly to: string };

export interface SecurityRule {
  readonly id: string;
  readonly recipient: AccessRecipient;
  readonly operation: AccessOperation;
  readonly effect: "allow" | "deny" | "mask";
  readonly selector: PolicySelector;
  readonly masks?: readonly MaskAction[];
}

export interface SecurityRules {
  readonly version: 1;
  readonly defaults: Readonly<Record<AccessRecipient, "allow" | "deny">>;
  readonly rules: readonly SecurityRule[];
}

export interface PolicySnapshot {
  readonly version: 1;
  /** Access-contract version, included in proposal/approval bindings. */
  readonly hash: ContentHash;
  readonly rules: SecurityRules;
}

export interface RoutingSettings {
  readonly version: 1;
  readonly timezone: string;
  readonly destinations: readonly { readonly id: string; readonly path: VaultPath }[];
  readonly daily: { readonly id: string; readonly folder: string; readonly filename: "YYYY-MM-DD.md"; readonly heading: string };
}

export interface InstructionSnapshot {
  readonly version: 1;
  readonly hash: ContentHash;
  readonly routing: RoutingSettings;
  readonly prose: string;
}

export interface ResearchBatch {
  readonly id: BatchId;
  readonly source: VaultPath;
  readonly sourceHash: ContentHash;
  readonly selectedHash: ContentHash;
  readonly range: { readonly start: number; readonly end: number };
  readonly provenance: "local" | "external";
}

export type TargetSnapshot =
  | { readonly exists: false }
  | { readonly exists: true; readonly hash: ContentHash };

export interface ProposedChange {
  readonly destinationId: DestinationId;
  /** Resolved by the plugin, never copied from model output. */
  readonly path: VaultPath;
  readonly operation: "create" | "update";
  readonly target: TargetSnapshot;
  readonly before: string;
  readonly after: string;
  readonly evidenceIds: readonly ExcerptId[];
}

export interface ChangeProposal {
  readonly version: 1;
  readonly id: ProposalId;
  readonly batch: ResearchBatch;
  readonly instructionsHash: ContentHash;
  readonly policyHash: ContentHash;
  readonly changes: readonly ProposedChange[];
  readonly issues: readonly { readonly code: string; readonly changeIndex?: number }[];
}

/** Hash input includes precisely the selected changes, in displayed order. */
export interface ApprovalBinding {
  readonly version: 1;
  readonly proposalId: ProposalId;
  readonly batch: ResearchBatch;
  readonly instructionsHash: ContentHash;
  readonly policyHash: ContentHash;
  readonly changes: readonly ProposedChange[];
}

/** Data describes a binding; it does not confer authority to write. */
export interface Approval {
  readonly id: string;
  readonly bindingHash: ContentHash;
  readonly issuedBy: "local-ui";
}

/** Approval-free plugin state; outcomes describe history, never write authority. */
export type ResearchProcessingState = "captured" | "proposed" | "rejected" | "partially-applied" | "applied";
export interface ResearchLedgerRecord {
  readonly batch: ResearchBatch;
  readonly firstCapturedAt: number;
  readonly lastCapturedAt: number;
  /** Monotone history makes sync merging preserve prior application evidence. */
  readonly outcomes: readonly ResearchProcessingState[];
  readonly conflicted: boolean;
}
export interface ResearchLedger {
  readonly version: 1;
  /** Malformed or overflowing histories fail closed rather than enable replay. */
  readonly blocked: boolean;
  readonly records: readonly ResearchLedgerRecord[];
}
