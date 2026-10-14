/** Public editor navigation only: opening and selection never modify note text. */
import { MarkdownView, TFile, type App, type Editor } from "obsidian";
import type { NavigationPort, NavTarget } from "../../core";

type Range = { start: number; end: number };
export type NavigationSurface = {
  openNote(path: string): Promise<Pick<Editor, "getValue" | "offsetToPos" | "setSelection" | "scrollIntoView"> | null>;
};
export type ResolveNavigationQuote = (text: string, quote: string, hintStart: number) => Range | null;

export function createObsidianNavigation(surface: NavigationSurface, resolve: ResolveNavigationQuote): NavigationPort {
  return {
    async openAt(target: NavTarget): Promise<void> {
      if (!target.path.toLowerCase().endsWith(".md")) return;
      const editor = await surface.openNote(target.path);
      if (!editor) return;
      const text = editor.getValue();
      // A vanished quote is stale: open the note but never highlight unrelated text.
      const range = target.quote !== undefined
        ? resolve(text, target.quote, target.start ?? 0)
        : target.start === undefined ? null : { start: target.start, end: target.end ?? target.start };
      if (!range || range.start < 0 || range.end < range.start || range.end > text.length) return;
      const from = editor.offsetToPos(range.start);
      const to = editor.offsetToPos(range.end);
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
    },
  };
}

export function createObsidianNavigationFromApp(app: App, resolve: ResolveNavigationQuote): NavigationPort {
  return createObsidianNavigation({
    async openNote(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return null;
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true, state: { mode: "source" } });
      if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== path) return null;
      return leaf.view.editor;
    },
  }, resolve);
}
