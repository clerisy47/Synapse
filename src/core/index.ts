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
  bodyStartOffset,
  estimateTokens,
  foldCase,
  hashPathForLog,
  normalizeClaimText,
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
  PdfDocHandle,
  PdfJsPort,
  StoragePort,
  Transport,
  TransportCapabilities,
  TransportErrorKind,
  VaultEvent,
  VaultPort,
} from "./ports";
export { TransportError } from "./ports";
