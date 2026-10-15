import type { ControlPaths, ProposedChange } from "./control-contracts";
import type { Result } from "./result";

/** The gate is local, ephemeral and checked again inside the atomic update. */
export interface NoteWriteRequest {
  readonly change: ProposedChange;
  readonly paths: ControlPaths;
  readonly signal: AbortSignal;
  revalidate(): Promise<boolean>;
  current(): boolean;
  willCommit(): void;
  editorSnapshots(): readonly { readonly path: string; readonly text: string }[];
}
export interface NoteWritePort {
  apply(request: NoteWriteRequest): Promise<Result<void>>;
}
export interface ApplyReport {
  readonly outcomes: readonly { readonly path: ProposedChange["path"]; readonly status: "applied" | "refused" | "unknown" | "not-attempted" }[];
}

/** Separate capability: destination and authorization are bound at construction. */
export interface ResearchAppendPort {
  append(request: {
    readonly before: string;
    readonly text: string;
    readonly signal: AbortSignal;
  }): Promise<Result<void>>;
}
