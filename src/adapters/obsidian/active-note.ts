/**
 * Obsidian ActiveNotePort — editor buffer + user activity (DESIGN §5.2 / F-15).
 * Activity comes from file-open / editor-change, never vault modify.
 */

import { MarkdownView, type App, type Editor, type TFile } from "obsidian";

import {
  asVaultPath,
  type ActiveNotePort,
  type Disposable,
  type VaultPath,
} from "../../core";

export type ActiveEditorLike = {
  getValue(): string;
  getCursor(pos?: "from" | "to"): { line: number; ch: number };
  posToOffset(pos: { line: number; ch: number }): number;
};

export type ActiveFileLike = {
  path: string;
  extension: string;
};

export type ActiveNoteWorkspaceSurface = {
  getActiveFile(): ActiveFileLike | null;
  getActiveEditor(): ActiveEditorLike | null;
  getOpenMarkdownFiles(): ActiveFileLike[];
  on(
    event: "file-open",
    cb: (file: ActiveFileLike | null) => void,
  ): Disposable;
  on(
    event: "editor-change",
    cb: (
      editor: ActiveEditorLike,
      info: { file: ActiveFileLike | null },
    ) => void,
  ): Disposable;
};

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function isMarkdown(
  file: ActiveFileLike | null | undefined,
): file is ActiveFileLike {
  return file != null && file.extension.toLowerCase() === "md";
}

function selectionFromEditor(
  editor: ActiveEditorLike,
): { start: number; end: number } | undefined {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const start = editor.posToOffset(from);
  const end = editor.posToOffset(to);
  if (start === end) {
    return undefined;
  }
  return start < end ? { start, end } : { start: end, end: start };
}

export function createObsidianActiveNote(
  workspace: ActiveNoteWorkspaceSurface,
): ActiveNotePort {
  return {
    current() {
      const file = workspace.getActiveFile();
      if (!isMarkdown(file)) {
        return null;
      }
      const editor = workspace.getActiveEditor();
      const text = editor ? editor.getValue() : "";
      const selection = editor ? selectionFromEditor(editor) : undefined;
      const out: {
        path: VaultPath;
        text: string;
        selection?: { start: number; end: number };
      } = {
        path: normalizePath(file.path),
        text,
      };
      if (selection) {
        out.selection = selection;
      }
      return out;
    },

    openNotes(): VaultPath[] {
      const seen = new Set<string>();
      const out: VaultPath[] = [];
      for (const file of workspace.getOpenMarkdownFiles()) {
        if (!isMarkdown(file)) {
          continue;
        }
        const p = normalizePath(file.path);
        if (seen.has(p)) {
          continue;
        }
        seen.add(p);
        out.push(p);
      }
      return out;
    },

    onActivity(cb): Disposable {
      const dOpen = workspace.on("file-open", (file) => {
        if (!isMarkdown(file)) {
          return;
        }
        cb({ type: "open", path: normalizePath(file.path) });
      });
      const dEdit = workspace.on("editor-change", (_editor, info) => {
        if (!isMarkdown(info.file)) {
          return;
        }
        cb({ type: "edit", path: normalizePath(info.file.path) });
      });
      return () => {
        dOpen();
        dEdit();
      };
    },
  };
}

/** Live App → ActiveNotePort. */
export function createObsidianActiveNoteFromApp(app: App): ActiveNotePort {
  const ws = app.workspace;

  const surface: ActiveNoteWorkspaceSurface = {
    getActiveFile(): ActiveFileLike | null {
      return ws.getActiveFile();
    },
    getActiveEditor(): ActiveEditorLike | null {
      const view = ws.getActiveViewOfType(MarkdownView);
      if (view?.editor) {
        return view.editor;
      }
      return null;
    },
    getOpenMarkdownFiles(): ActiveFileLike[] {
      const leaves = ws.getLeavesOfType("markdown");
      const out: ActiveFileLike[] = [];
      for (const leaf of leaves) {
        const file = (leaf.view as MarkdownView | null)?.file;
        if (file) {
          out.push(file);
        }
      }
      return out;
    },
    on(event, cb): Disposable {
      const ref = ws.on(
        event as "file-open",
        cb as (file: TFile | null) => void,
      );
      return () => {
        ws.offref(ref);
      };
    },
  };

  return createObsidianActiveNote(surface);
}

/** Re-export Editor type for tests that stub editors. */
export type { Editor };
