/**
 * Obsidian MetadataPort against an injectable cache (M2-T10).
 */

import { describe, expect, it } from "vitest";

import { asVaultPath } from "../../core";
import {
  createObsidianMetadata,
  type FileCacheLike,
  type MetadataCacheSurface,
} from "./metadata";

function memoryCache(
  seed: Record<string, FileCacheLike | null>,
  links: Record<string, Record<string, number>> = {},
): MetadataCacheSurface & {
  caches: Map<string, FileCacheLike | null>;
  emitChanged: (path: string) => void;
  emitResolved: () => void;
} {
  const caches = new Map(Object.entries(seed));
  const changed = new Set<(file: { path: string }) => void>();
  const resolved = new Set<() => void>();

  return {
    caches,
    resolvedLinks: links,
    getCache(path) {
      if (!caches.has(path)) {
        return undefined;
      }
      return caches.get(path);
    },
    onChanged(cb) {
      changed.add(cb);
      return () => {
        changed.delete(cb);
      };
    },
    onResolved(cb) {
      resolved.add(cb);
      return () => {
        resolved.delete(cb);
      };
    },
    emitChanged(path) {
      for (const cb of [...changed]) {
        cb({ path });
      }
    },
    emitResolved() {
      for (const cb of [...resolved]) {
        cb();
      }
    },
  };
}

describe("createObsidianMetadata", () => {
  it("returns null when cache missing (fail-closed)", () => {
    const cache = memoryCache({});
    const port = createObsidianMetadata({ cache });
    expect(port.get(asVaultPath("a.md"))).toBeNull();
  });

  it("maps frontmatter, tags, and headings", () => {
    const cache = memoryCache({
      "Notes/A.md": {
        frontmatter: { tags: ["Project/X", "y"], title: "Hi" },
        tags: [{ tag: "#inline" }],
        headings: [
          {
            heading: "Intro",
            level: 1,
            position: { start: { line: 2 } },
          },
        ],
      },
    });
    const port = createObsidianMetadata({ cache, initiallyResolved: true });
    expect(port.isResolved()).toBe(true);
    const meta = port.get(asVaultPath("Notes/A.md"));
    expect(meta).not.toBeNull();
    expect(meta?.frontmatter.title).toBe("Hi");
    expect(meta?.tags).toEqual(["project/x", "y", "inline"]);
    expect(meta?.headings).toEqual([{ text: "Intro", level: 1, line: 2 }]);
  });

  it("returns null for non-md paths", () => {
    const cache = memoryCache({
      "a.pdf": { frontmatter: {}, tags: [], headings: [] },
    });
    const port = createObsidianMetadata({ cache });
    expect(port.get(asVaultPath("a.pdf"))).toBeNull();
  });

  it("exposes resolvedLinks and events", () => {
    const cache = memoryCache(
      { "a.md": { frontmatter: {}, tags: [], headings: [] } },
      { "a.md": { "b.md": 1 } },
    );
    const port = createObsidianMetadata({ cache });
    expect(port.resolvedLinks()).toEqual({ "a.md": { "b.md": 1 } });
    expect(port.isResolved()).toBe(false);

    const paths: string[] = [];
    let resolvedCount = 0;
    port.onChanged((p) => {
      paths.push(p);
    });
    port.onResolved(() => {
      resolvedCount++;
    });
    cache.emitChanged("a.md");
    cache.emitResolved();
    expect(paths).toEqual(["a.md"]);
    expect(resolvedCount).toBe(1);
    expect(port.isResolved()).toBe(true);
  });
});
