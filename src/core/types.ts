/**
 * Core value types (DESIGN §4.1). Pure types — no I/O.
 */

/** Vault-relative, forward slashes: "Projects/idea.md", "Papers/x.pdf". */
export type VaultPath = string & { readonly __brand: "VaultPath" };

export function asVaultPath(path: string): VaultPath {
  return path.replace(/\\/g, "/") as VaultPath;
}

export type SourceKind = "note" | "pdf";

export interface SourceRef {
  path: VaultPath;
  kind: SourceKind;
}

export type PdfStatus =
  | "pending"
  | "ok"
  | "partial"
  | "no_text_layer"
  | "encrypted"
  | "corrupt";

export interface PdfMeta {
  pageCount: number;
  status: PdfStatus;
  emptyPages: number[];
}

/** One per indexed (non-excluded) file. Never contains body text. */
export interface DocMeta {
  ref: SourceRef;
  title: string;
  aliases: string[];
  tags: string[];
  folder: string;
  mtime: number;
  ctime: number;
  size: number;
  pdf?: PdfMeta;
}

/** Offsets into full file text (notes) or page text (PDFs). */
export interface Locator {
  page?: number;
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
