export interface WorkspacePort { canonicalize(input: string): Promise<string> }
export interface TerminalPort {
  readonly interactive: boolean;
  out(text: string): void;
  error(text: string): void;
}

export interface NoteSnapshot { readonly path: string; readonly text: string; readonly generation: string; readonly modifiedAt: number }
export interface WorkspaceReadPort {
  list(): Promise<readonly string[]>;
  read(path: string): Promise<NoteSnapshot | undefined>;
  watch(invalidate: () => void): () => void;
}
export interface CorpusPolicy {
  readonly excludedFolders: readonly string[];
  readonly excludedTags: readonly string[];
  readonly instructionPath: string;
  readonly researchPath: string;
}
export const CORPUS_LIMITS = {
  maxFiles: 10_000, maxFileBytes: 1_000_000, maxTotalBytes: 32_000_000,
  maxDepth: 32, maxVisitedEntries: 50_000, maxResults: 20, passageLines: 12,
} as const;
export const DEFAULT_POLICY: CorpusPolicy = {
  excludedFolders: [], excludedTags: [], instructionPath: "Synapse/Instructions.md", researchPath: "Research.md",
};
export function validNotePath(path: string): boolean {
  return path.length > 0 && !path.includes("\\") && !path.includes(":") && !path.includes("\u0000") &&
    !path.startsWith("/") && path.split("/").every(part => part !== "" && part !== "." && part !== ".." && !part.startsWith(".")) && /\.md$/iu.test(path);
}
export function permittedPath(path: string, policy: CorpusPolicy): boolean {
  return validNotePath(path) && path !== policy.instructionPath && path !== policy.researchPath &&
    !policy.excludedFolders.some(folder => path === folder || path.startsWith(`${folder}/`));
}
export interface FrontmatterPort { parse(text: string): { readonly fields: unknown; readonly body: string; readonly bodyLine: number } | undefined }
