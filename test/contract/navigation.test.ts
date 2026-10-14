import { describe, expect, it, vi } from "vitest";
import { asVaultPath } from "../../src/core";
import { resolveAnchor } from "../../src/evidence";
import { createObsidianNavigation } from "../../src/adapters/obsidian";

function setup(text: string) {
  const editor = {
    getValue: () => text,
    offsetToPos: (offset: number) => ({ line: text.slice(0, offset).split("\n").length - 1, ch: offset - (text.lastIndexOf("\n", offset - 1) + 1) }),
    setSelection: vi.fn(), scrollIntoView: vi.fn(),
  };
  const surface = { openNote: vi.fn(async () => editor) };
  const navigation = createObsidianNavigation(surface, (current, quote, hintStart) =>
    resolveAnchor(current, { quote, hintStart, hintLine: 0, textHash: "" }));
  return { editor, surface, navigation };
}

describe("citation navigation", () => {
  it("resolves edits against the live buffer and selects a multiline passage", async () => {
    const { navigation, editor, surface } = setup("new prefix\npassage\ncontinued\nend");
    await navigation.openAt({ path: asVaultPath("Note.md"), quote: "passage\ncontinued", start: 0, end: 17 });
    expect(surface.openNote).toHaveBeenCalledWith("Note.md");
    const range = { from: { line: 1, ch: 0 }, to: { line: 2, ch: 9 } };
    expect(editor.setSelection).toHaveBeenCalledWith(range.from, range.to);
    expect(editor.scrollIntoView).toHaveBeenCalledWith(range, true);
  });
  it("uses the hint to distinguish duplicate passages", async () => {
    const { navigation, editor } = setup("quote\nquote");
    await navigation.openAt({ path: asVaultPath("Note.md"), quote: "quote", start: 6 });
    expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 1, ch: 5 });
  });
  it("opens stale citations without selecting unrelated offsets", async () => {
    const { navigation, editor } = setup("replacement");
    await navigation.openAt({ path: asVaultPath("Note.md"), quote: "vanished", start: 0, end: 8 });
    expect(editor.setSelection).not.toHaveBeenCalled();
  });
  it("rejects non-Markdown navigation targets", async () => {
    const { navigation, surface } = setup("");
    for (const path of ["Paper.pdf", "image.png"]) await navigation.openAt({ path: asVaultPath(path) });
    expect(surface.openNote).not.toHaveBeenCalled();
  });
  it("rejects invalid offset ranges", async () => {
    const { navigation, editor } = setup("short");
    await navigation.openAt({ path: asVaultPath("Note.md"), start: 0, end: 100 });
    expect(editor.setSelection).not.toHaveBeenCalled();
  });
});
