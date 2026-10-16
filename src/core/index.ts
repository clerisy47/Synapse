export type {
  Anchor,
  DocMeta,
  Excerpt,
  ExcerptId,
  Locator,
  SourceKind,
  SourceRef,
  VaultPath,
} from "./types";
export { asVaultPath } from "./types";

export type { ErrorCode, RemediationKey, SynapseError, SynapseErrorInit } from "./errors";
export { synapseError } from "./errors";

export type { Result } from "./result";
export { err, isErr, isOk, ok } from "./result";

export {
  bodyStartOffset,
  estimateTokens,
  foldCase,
  hashPathForLog,
  sha1Hex,
  stableStringify,
} from "./text";

export type { Clock } from "./clock";

export type { LogFields, LogLevel, Logger } from "./logger";

export type { Disposable, MutableObservable, Observable } from "./observable";
export { createObservable } from "./observable";

export type {
  ActiveNotePort,
  FileStat,
  MetadataPort,
  NavTarget,
  NavigationPort,
  NoteMetadata,
  StoragePort,
  Transport,
  TransportCapabilities,
  TransportErrorKind,
  VaultEvent,
  VaultPort,
} from "./ports";
export { TransportError } from "./ports";

export type {
  AccessContext, AccessOperation, AccessRecipient, Approval, ApprovalBinding,
  BatchId, ChangeProposal, ClientCapability, ContentHash, ControlPaths,
  DestinationId, InstructionSnapshot, MaskAction, PolicySelector, PolicySnapshot,
  ProposalId, ProposedChange, ResearchBatch, ResearchLedger, ResearchLedgerRecord, ResearchProcessingState, RoutingSettings, SecurityRule,
  SecurityRules, TargetSnapshot,
} from "./control-contracts";
export { validateControlPaths, validateVaultPath } from "./control-paths";
export { contentHash, hashApprovalBinding } from "./control-hash";

export type { NoteWritePort, NoteWriteRequest, ResearchAppendPort, ApplyReport } from "./note-write";

export type { McpScope, McpGrant, McpStatus, McpLimits, McpServerPort, McpServerOptions, McpResult } from "./mcp";
