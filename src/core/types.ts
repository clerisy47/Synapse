/**
 * Core value types (DESIGN §4.1). Pure types — no I/O.
 */

/** Vault-relative, forward slashes: "Projects/idea.md". */
export type VaultPath = string & { readonly __brand: "VaultPath" };

export function asVaultPath(path: string): VaultPath {
  return path.replace(/\\/g, "/") as VaultPath;
}

export type SourceKind = "note";

export interface SourceRef {
  path: VaultPath;
  kind: SourceKind;
}

/** One per indexed (non-excluded) file. Never contains body text. */
export interface DocMeta {
  ref: SourceRef;
  title: string;
  /** Validated in the production corpus; optional for legacy injected ports. */
  description?: string;
  aliases: string[];
  tags: string[];
  folder: string;
  mtime: number;
  ctime: number;
  size: number;
}

/** Offsets into full Markdown file text. */
export interface Locator {
  start: number;
  end: number;
  line?: number;
  heading?: string;
}

export interface Excerpt {
  ref: SourceRef;
  locator: Locator;
  text: string;
  textHash: string;
  sourceMtime: number;
}

/** Per-run handle minted by EvidenceLedger. Never persisted. */
export type ExcerptId = `E${number}`;

/** Survives edits: resolve by quote first, then by hint. */
export interface Anchor {
  quote: string;
  textHash: string;
  hintStart: number;
  hintLine: number;
}
