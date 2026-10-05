/**
 * I/O ports (DESIGN §5.2). The only way modules touch the outside world.
 * Concrete adapters live under `adapters/`; fakes under `test/fakes`.
 */

import type { SourceKind, VaultPath } from "./types";
import type { Disposable } from "./observable";

export interface FileStat {
  path: VaultPath;
  kind: SourceKind;
  mtime: number;
  ctime: number;
  size: number;
}

export type VaultEvent =
  | { type: "create" | "modify" | "delete"; path: VaultPath }
  | { type: "rename"; from: VaultPath; to: VaultPath };

/** `.md` and `.pdf` only. */
export interface VaultPort {
  listFiles(): Promise<FileStat[]>;
  stat(path: VaultPath): Promise<FileStat | null>;
  /** Notes. */
  readText(path: VaultPath): Promise<string>;
  /** PDFs. */
  readBinary(path: VaultPath): Promise<ArrayBuffer>;
  onChange(cb: (e: VaultEvent) => void): Disposable;
}

export interface NoteMetadata {
  frontmatter: Record<string, unknown>;
  /** Frontmatter + inline, normalized. */
  tags: string[];
  headings: { text: string; level: number; line: number }[];
}

export interface MetadataPort {
  /** Initial resolve finished. */
  isResolved(): boolean;
  /** `null` = not parsed yet → caller fails closed. */
  get(path: VaultPath): NoteMetadata | null;
  /** source → target → count */
  resolvedLinks(): Record<string, Record<string, number>>;
  onChanged(cb: (path: VaultPath) => void): Disposable;
  onResolved(cb: () => void): Disposable;
}

/** Plugin-folder-confined. The ONLY writer in the codebase (AC-M8.5). */
export interface StoragePort {
  /** Parsed JSON, or `null` when the relative path is absent (DESIGN §5.2). */
  readJson(rel: string): Promise<unknown>;
  writeJson(rel: string, v: unknown): Promise<void>;
  remove(rel: string): Promise<void>;
  list(relDir: string): Promise<string[]>;
  removeDir(relDir: string): Promise<void>;
  /** `data.json`; `null` when absent (DESIGN §5.2). */
  loadData(): Promise<unknown>;
  saveData(v: unknown): Promise<void>;
  /** If the API version offers it [U]. */
  onExternalDataChange(cb: () => void): Disposable;
}

export interface PdfDocHandle {
  pageCount: number;
  pageText(n: number): Promise<string>;
  destroy(): Promise<void>;
}

export interface PdfJsPort {
  version(): string;
  /** Throws PDF_ENCRYPTED | PDF_CORRUPT | PDFJS_UNAVAILABLE. */
  open(bytes: ArrayBuffer): Promise<PdfDocHandle>;
}

export type NavTarget = {
  path: VaultPath;
  page?: number;
  line?: number;
  start?: number;
  end?: number;
  quote?: string;
};

/** Best-effort scroll + highlight; never edits. */
export interface NavigationPort {
  openAt(t: NavTarget): Promise<void>;
}

export interface ActiveNotePort {
  /** Editor buffer; may be ahead of disk. */
  current(): {
    path: VaultPath;
    text: string;
    selection?: { start: number; end: number };
  } | null;
  openNotes(): VaultPath[];
  /** User activity only. */
  onActivity(cb: (e: { type: "open" | "edit"; path: VaultPath }) => void): Disposable;
}

export interface TransportCapabilities {
  streaming: boolean;
  abortable: boolean;
}

export interface Transport {
  readonly capabilities: TransportCapabilities;
  getJson(
    url: string,
    o: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ status: number; body: unknown }>;
  /**
   * One parsed JSON object per NDJSON line.
   * Non-streaming transports yield exactly one.
   */
  postStream(
    url: string,
    body: unknown,
    o: {
      signal: AbortSignal;
      firstByteTimeoutMs: number;
      idleTimeoutMs: number;
    },
  ): AsyncIterable<unknown>;
}

export type TransportErrorKind =
  | "refused"
  | "dns"
  | "timeout_first_byte"
  | "timeout_idle"
  | "http"
  | "aborted"
  | "protocol"
  | "blocked";

/** Thrown by `Transport` implementations; `llm` maps onto `SynapseError`. */
export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly status?: number;

  constructor(init: {
    kind: TransportErrorKind;
    status?: number;
    message?: string;
  }) {
    super(init.message ?? init.kind);
    this.name = "TransportError";
    this.kind = init.kind;
    if (init.status !== undefined) {
      this.status = init.status;
    }
  }
}
