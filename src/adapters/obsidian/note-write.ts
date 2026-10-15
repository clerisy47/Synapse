import { MarkdownView, TFile, type App } from "obsidian";
import { err, ok, synapseError, validateControlPaths, validateVaultPath, type ControlPaths, type ResearchAppendPort, type NoteWritePort, type NoteWriteRequest, type ProposedChange, type Result } from "../../core";

/** No raw filesystem writes, folder creation, deletion or rename. */
export interface NoteWriteSurface {
  entries(this: void): readonly { path: string; markdown: boolean }[];
  /** Every open Markdown leaf, including background panes. null means unverifiable. */
  editors(this: void): readonly { path: string; text: string | null }[];
  exists(this: void, path: string): Promise<boolean>;
  read(this: void, path: string): Promise<string>;
  process(this: void, path: string, update: (current: string) => string): Promise<void>;
  create(this: void, path: string, text: string): Promise<void>;
}
const refused = () => err(synapseError({ code: "SCHEMA_INVALID", message: "Note application refused" }));
export function createObsidianNoteWriter(surface: NoteWriteSurface): NoteWritePort { return createWriter(surface, false); }
type WriteRequest = Omit<NoteWriteRequest, "change"> & {
  readonly change: Pick<ProposedChange, "path" | "operation" | "before" | "after"> & { readonly target: { readonly exists: boolean } };
};
function createWriter(surface: NoteWriteSurface, inboxOnly: boolean): { apply(input: WriteRequest): Promise<Result<void>> } {
  let busy = false;
  return {
    async apply(input: WriteRequest) {
      if (busy) return refused();
      busy = true;
      // Snapshot caller-owned data before the first await.
      let submitted = false;
      try {
        const change = structuredClone(input.change);
        const paths = structuredClone(input.paths);
        const alive = () => !input.signal.aborted && input.current();
        const guardsMatch = () => input.editorSnapshots().every((snapshot) => editorsMatch(snapshot.path, snapshot.text));
        const editorsMatch = (path: string, text: string) => surface.editors().every((editor) => editor.path.toLowerCase() !== path.toLowerCase() || (editor.path === path && editor.text === text));
        const matches = () => surface.entries().filter((entry) => entry.path.toLowerCase() === change.path.toLowerCase());
        const path = validateVaultPath(change.path);
        if (!path.ok || path.value !== change.path || !validateControlPaths(paths).ok
          || [paths.instructions, paths.security].some((control) => control.toLowerCase() === change.path.toLowerCase())
          || (inboxOnly ? change.path !== paths.research || change.operation !== "update" || !change.after.startsWith(change.before) || change.after.length <= change.before.length
            : change.path.toLowerCase() === paths.research.toLowerCase())
          || !["create", "update"].includes(change.operation) || (change.operation === "update") !== change.target.exists
          || (!change.target.exists && change.before !== "") || !alive()) return refused();
        if (!await input.revalidate() || !alive() || !guardsMatch()) return refused();
        if (change.operation === "create") {
          if (matches().length || await surface.exists(change.path) || !editorsMatch(change.path, "")) return refused();
          if (!await input.revalidate() || !alive() || !guardsMatch() || matches().length) return refused();
          // create() must fail if the path already exists; it never overwrites.
          if (!alive()) return refused();
          input.willCommit();
          submitted = true;
          await surface.create(change.path, change.after);
        } else {
          const entries = matches();
          if (entries.length !== 1 || entries[0].path !== change.path || !entries[0].markdown
            || await surface.read(change.path) !== change.before || !editorsMatch(change.path, change.before)) return refused();
          if (!await input.revalidate() || !alive() || !guardsMatch()) return refused();
          await surface.process(change.path, (text) => {
            const entries = matches();
            if (!alive() || !guardsMatch() || entries.length !== 1 || entries[0].path !== change.path || !entries[0].markdown
              || text !== change.before || !editorsMatch(change.path, text)) throw new Error("Note application refused");
            input.willCommit();
            submitted = true;
            return change.after;
          });
        }
        return ok(undefined);
      } catch { return submitted ? err(synapseError({ code: "STORAGE_WRITE_FAILED", message: "Note write outcome unknown", detail: { issueCode: "WRITE_OUTCOME_UNKNOWN" } })) : refused(); } finally { busy = false; }
    },
  };
}
export function createObsidianNoteWriterFromApp(app: App): NoteWritePort {
  const vault = app.vault;
  const file = (path: string) => { const entry = vault.getAbstractFileByPath(path); if (!(entry instanceof TFile)) throw new Error("Note application refused"); return entry; };
  return createObsidianNoteWriter({
    entries: () => vault.getAllLoadedFiles().map((entry) => ({ path: entry.path, markdown: entry instanceof TFile && entry.extension === "md" })),
    editors: () => app.workspace.getLeavesOfType("markdown").flatMap((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) return [];
      return [{ path: view.file.path, text: view.editor?.getValue() ?? null }];
    }),
    exists: (path) => vault.adapter.exists(path),
    read: (path) => vault.read(file(path)),
    async process(path, update) { await vault.process(file(path), update); },
    async create(path, text) { await vault.create(path, text); },
  });
}

/** Uncomposed until authenticated MCP submission lands. Scope is never request data. */
export function createObsidianResearchAppender(surface: NoteWriteSurface, controls: ControlPaths, gate: {
  revalidate(): Promise<boolean>;
  current(): boolean;
}): ResearchAppendPort {
  const paths = structuredClone(controls);
  const writer = createWriter(surface, true);
  return {
    async append(request) {
      if (!request.text.trim()) return refused();
      return writer.apply({ paths, signal: request.signal, current: () => gate.current(), revalidate: () => gate.revalidate(),
        willCommit: () => {}, editorSnapshots: () => [],
        change: { path: paths.research, operation: "update", target: { exists: true },
          before: request.before, after: request.before + request.text } });
    },
  };
}
