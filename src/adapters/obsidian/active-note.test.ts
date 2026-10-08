/**
 * Obsidian ActiveNotePort against an injectable workspace (M2-T10).
 */

import { describe, expect, it, vi } from "vitest";

import {
  createObsidianActiveNote,
  type ActiveEditorLike,
  type ActiveFileLike,
  type ActiveNoteWorkspaceSurface,
} from "./active-note";

function editor(
  text: string,
  sel?: { from: number; to: number },
): ActiveEditorLike {
  const from = sel?.from ?? 0;
  const to = sel?.to ?? 0;
  return {
    getValue: () => text,
    getCursor(pos) {
      const off = pos === "to" ? to : from;
      return { line: 0, ch: off };
    },
    posToOffset(pos) {
      return pos.ch;
    },
  };
}

function memoryWorkspace(
  opts: {
    active?: ActiveFileLike | null;
    ed?: ActiveEditorLike | null;
    open?: ActiveFileLike[];
  } = {},
): ActiveNoteWorkspaceSurface & {
  emitOpen: (file: ActiveFileLike | null) => void;
  emitEdit: (file: ActiveFileLike | null) => void;
} {
  let active = opts.active ?? null;
  let ed = opts.ed ?? null;
  const open = opts.open ?? [];
  const openListeners = new Set<(file: ActiveFileLike | null) => void>();
  const editListeners = new Set<
    (editor: ActiveEditorLike, info: { file: ActiveFileLike | null }) => void
  >();

  return {
    getActiveFile: () => active,
    getActiveEditor: () => ed,
    getOpenMarkdownFiles: () => open,
    on(event, cb) {
      if (event === "file-open") {
        openListeners.add(cb as (file: ActiveFileLike | null) => void);
        return () => {
          openListeners.delete(cb as (file: ActiveFileLike | null) => void);
        };
      }
      editListeners.add(
        cb as (
          editor: ActiveEditorLike,
          info: { file: ActiveFileLike | null },
        ) => void,
      );
      return () => {
        editListeners.delete(
          cb as (
            editor: ActiveEditorLike,
            info: { file: ActiveFileLike | null },
          ) => void,
        );
      };
    },
    emitOpen(file) {
      active = file;
      for (const cb of [...openListeners]) {
        cb(file);
      }
    },
    emitEdit(file) {
      for (const cb of [...editListeners]) {
        cb(ed ?? editor(""), { file });
      }
    },
  };
}

describe("createObsidianActiveNote", () => {
  it("current returns editor buffer and selection", () => {
    const ws = memoryWorkspace({
      active: { path: "Notes/A.md", extension: "md" },
      ed: editor("hello world", { from: 0, to: 5 }),
    });
    const port = createObsidianActiveNote(ws);
    expect(port.current()).toEqual({
      path: "Notes/A.md",
      text: "hello world",
      selection: { start: 0, end: 5 },
    });
  });

  it("current returns null for non-markdown active file", () => {
    const ws = memoryWorkspace({
      active: { path: "x.pdf", extension: "pdf" },
      ed: editor("nope"),
    });
    expect(createObsidianActiveNote(ws).current()).toBeNull();
  });

  it("openNotes dedupes markdown paths", () => {
    const ws = memoryWorkspace({
      open: [
        { path: "a.md", extension: "md" },
        { path: "a.md", extension: "md" },
        { path: "b.pdf", extension: "pdf" },
        { path: "c.md", extension: "md" },
      ],
    });
    expect(createObsidianActiveNote(ws).openNotes()).toEqual(["a.md", "c.md"]);
  });

  it("onActivity emits open/edit for markdown only", () => {
    const ws = memoryWorkspace();
    const port = createObsidianActiveNote(ws);
    const events: unknown[] = [];
    port.onActivity((e) => {
      events.push(e);
    });

    ws.emitOpen({ path: "a.md", extension: "md" });
    ws.emitOpen({ path: "x.pdf", extension: "pdf" });
    ws.emitEdit({ path: "a.md", extension: "md" });
    ws.emitEdit({ path: "y.txt", extension: "txt" });

    expect(events).toEqual([
      { type: "open", path: "a.md" },
      { type: "edit", path: "a.md" },
    ]);
  });

  it("dispose stops activity callbacks", () => {
    const ws = memoryWorkspace();
    const spy = vi.fn();
    const d = createObsidianActiveNote(ws).onActivity(spy);
    d();
    ws.emitOpen({ path: "a.md", extension: "md" });
    expect(spy).not.toHaveBeenCalled();
  });
});
