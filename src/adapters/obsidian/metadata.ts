/**
 * Obsidian MetadataPort — fail-closed when cache missing (DESIGN §5.2 / §6.6).
 */

import type { App, TAbstractFile, TFile } from "obsidian";

import {
  asVaultPath,
  type Disposable,
  type MetadataPort,
  type NoteMetadata,
  type VaultPath,
} from "../../core";

/** Minimal cached metadata shape (testable without Obsidian). */
export type FileCacheLike = {
  frontmatter?: Record<string, unknown> | null;
  tags?: { tag: string }[] | null;
  headings?: {
    heading: string;
    level: number;
    position: { start: { line: number } };
  }[] | null;
};

export type MetadataCacheSurface = {
  getCache(path: string): FileCacheLike | null | undefined;
  resolvedLinks: Record<string, Record<string, number>>;
  onChanged(cb: (file: { path: string }) => void): Disposable;
  onResolved(cb: () => void): Disposable;
};

export type CreateObsidianMetadataOptions = {
  cache: MetadataCacheSurface;
  /** When true, isResolved() starts true (layout-ready / empty vault). */
  initiallyResolved?: boolean;
};

function normalizePath(path: string): VaultPath {
  return asVaultPath(path.replace(/\\/g, "/").replace(/^\/+/, ""));
}

function normalizeTag(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("#")) {
    t = t.slice(1);
  }
  return t.toLowerCase();
}

function collectTags(cache: FileCacheLike): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const fm = cache.frontmatter;
  if (fm) {
    const raw = fm.tags ?? fm.tag;
    if (typeof raw === "string") {
      for (const part of raw.split(/[,\s]+/)) {
        const t = normalizeTag(part);
        if (t.length > 0 && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") {
          const t = normalizeTag(item);
          if (t.length > 0 && !seen.has(t)) {
            seen.add(t);
            out.push(t);
          }
        }
      }
    }
  }

  if (cache.tags) {
    for (const entry of cache.tags) {
      const t = normalizeTag(entry.tag);
      if (t.length > 0 && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }

  return out;
}

function toNoteMetadata(cache: FileCacheLike): NoteMetadata {
  const frontmatter: Record<string, unknown> = {};
  if (cache.frontmatter) {
    for (const [k, v] of Object.entries(cache.frontmatter)) {
      frontmatter[k] = v;
    }
  }
  const headings: NoteMetadata["headings"] = [];
  if (cache.headings) {
    for (const h of cache.headings) {
      headings.push({
        text: h.heading,
        level: h.level,
        line: h.position.start.line,
      });
    }
  }
  return {
    frontmatter,
    tags: collectTags(cache),
    headings,
  };
}

export function createObsidianMetadata(
  opts: CreateObsidianMetadataOptions,
): MetadataPort {
  const { cache } = opts;
  let resolved = opts.initiallyResolved ?? false;

  return {
    isResolved(): boolean {
      return resolved;
    },

    get(path: VaultPath): NoteMetadata | null {
      const key = normalizePath(path);
      if (!key.toLowerCase().endsWith(".md")) {
        return null;
      }
      const hit = cache.getCache(key);
      if (hit == null) {
        return null;
      }
      return toNoteMetadata(hit);
    },

    resolvedLinks(): Record<string, Record<string, number>> {
      return cache.resolvedLinks;
    },

    onChanged(cb: (path: VaultPath) => void): Disposable {
      return cache.onChanged((file) => {
        cb(normalizePath(file.path));
      });
    },

    onResolved(cb: () => void): Disposable {
      return cache.onResolved(() => {
        resolved = true;
        cb();
      });
    },
  };
}

/** Live App → MetadataPort. */
export function createObsidianMetadataFromApp(app: App): MetadataPort {
  const mc = app.metadataCache;
  const surface: MetadataCacheSurface = {
    getCache(path: string): FileCacheLike | null | undefined {
      return mc.getCache(path) ?? undefined;
    },
    get resolvedLinks(): Record<string, Record<string, number>> {
      return mc.resolvedLinks;
    },
    onChanged(cb): Disposable {
      const ref = mc.on("changed", (file: TAbstractFile) => {
        cb({ path: file.path });
      });
      return () => {
        mc.offref(ref);
      };
    },
    onResolved(cb): Disposable {
      const ref = mc.on("resolved", cb);
      return () => {
        mc.offref(ref);
      };
    },
  };

  const markdownFiles: TFile[] =
    typeof app.vault.getMarkdownFiles === "function"
      ? app.vault.getMarkdownFiles()
      : app.vault.getFiles().filter((f) => f.extension === "md");

  let initiallyResolved = markdownFiles.length === 0;
  if (!initiallyResolved) {
    for (const f of markdownFiles) {
      if (mc.getCache(f.path) != null) {
        initiallyResolved = true;
        break;
      }
    }
  }

  return createObsidianMetadata({ cache: surface, initiallyResolved });
}
