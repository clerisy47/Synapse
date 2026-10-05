export type {
  Anchor,
  DocMeta,
  Excerpt,
  ExcerptId,
  Locator,
  PdfMeta,
  PdfStatus,
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
  estimateTokens,
  foldCase,
  hashPathForLog,
  normalizeClaimText,
  sha1Hex,
  stableStringify,
} from "./text";
