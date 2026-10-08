/**
 * Obsidian VaultPort against an injectable surface (M2-T10).
 */

import { describe, expect, it, vi } from "vitest";

import { asVaultPath } from "../../core";
import {
  createObsidianVault,
  type VaultAdapterSurface,
  type VaultFileLike,
} from "./vault";

function file(
  path: string,
  extension: string,
  opts: {
    mtime?: number;
    ctime?: number;
    size?: number;
    text?: string;
    bytes?: ArrayBuffer;
  } = {},
): VaultFileLike & { text?: string; bytes?: ArrayBuffer } {
  const out: VaultFileLike & { text?: string; bytes?: ArrayBuffer } = {
    path,
    extension,
    stat: {
      mtime: opts.mtime ?? 100,
      ctime: opts.ctime ?? 50,
      size: opts.size ?? 10,
    },
  };
  if (opts.text !== undefined) {
    out.text = opts.text;
  }
  if (opts.bytes !== undefined) {
    out.bytes = opts.bytes;
  }
  return out;
}

function memoryVault(
  seed: Array<VaultFileLike & { text?: string; bytes?: ArrayBuffer }>,
): VaultAdapterSurface & {
  files: Map<string, VaultFileLike & { text?: string; bytes?: ArrayBuffer }>;
  emit: (
    event: "create" | "modify" | "delete" | "rename",
    f: VaultFileLike,
    oldPath?: string,
  ) => void;
} {
  const files = new Map(seed.map((f) => [f.path, f]));
  const listeners = new Map<
    string,
    Set<(file: VaultFileLike, oldPath?: string) => void>
  >();

  return {
    files,
    getFiles() {
      return [...files.values()];
    },
    getAbstractFileByPath(path: string) {
      return files.get(path) ?? null;
    },
    async read(f) {
      const hit = files.get(f.path);
      if (hit?.text === undefined) {
        throw new Error("no text");
      }
      return hit.text;
    },
    async readBinary(f) {
      return files.get(f.path)?.bytes ?? new ArrayBuffer(0);
    },
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    emit(event, f, oldPath) {
      for (const cb of listeners.get(event) ?? []) {
        cb(f, oldPath);
      }
    },
  };
}

describe("createObsidianVault", () => {
  it("lists only .md and .pdf files", async () => {
    const surface = memoryVault([
      file("a.md", "md", { text: "hi" }),
      file("b.pdf", "pdf", { bytes: new ArrayBuffer(4) }),
      file("c.txt", "txt", { text: "nope" }),
    ]);
    const port = createObsidianVault(surface);
    const listed = await port.listFiles();
    expect(listed.map((s) => s.path)).toEqual(["a.md", "b.pdf"]);
    expect(listed[0]?.kind).toBe("note");
    expect(listed[1]?.kind).toBe("pdf");
  });

  it("stat returns null for missing or non-corpus paths", async () => {
    const surface = memoryVault([file("a.md", "md", { text: "x" })]);
    const port = createObsidianVault(surface);
    expect(await port.stat(asVaultPath("missing.md"))).toBeNull();
    surface.files.set("c.txt", file("c.txt", "txt"));
    expect(await port.stat(asVaultPath("c.txt"))).toBeNull();
  });

  it("readText / readBinary enforce kind", async () => {
    const surface = memoryVault([
      file("a.md", "md", { text: "hello" }),
      file("b.pdf", "pdf", { bytes: new Uint8Array([1, 2]).buffer }),
    ]);
    const port = createObsidianVault(surface);
    expect(await port.readText(asVaultPath("a.md"))).toBe("hello");
    await expect(port.readText(asVaultPath("b.pdf"))).rejects.toThrow(/note/);
    await expect(port.readBinary(asVaultPath("a.md"))).rejects.toThrow(/pdf/);
    expect((await port.readBinary(asVaultPath("b.pdf"))).byteLength).toBe(2);
  });

  it("onChange filters non-corpus and maps rename", () => {
    const surface = memoryVault([file("a.md", "md", { text: "x" })]);
    const port = createObsidianVault(surface);
    const events: unknown[] = [];
    const dispose = port.onChange((e) => {
      events.push(e);
    });

    surface.emit("create", file("n.md", "md"));
    surface.emit("create", file("skip.txt", "txt"));
    surface.emit("modify", file("a.md", "md"));
    surface.emit("delete", file("a.md", "md"));
    surface.emit("rename", file("b.md", "md"), "a.md");

    expect(events).toEqual([
      { type: "create", path: "n.md" },
      { type: "modify", path: "a.md" },
      { type: "delete", path: "a.md" },
      { type: "rename", from: "a.md", to: "b.md" },
    ]);

    dispose();
    surface.emit("create", file("z.md", "md"));
    expect(events).toHaveLength(4);
  });

  it("dispose unsubscribes", () => {
    const surface = memoryVault([]);
    const spy = vi.fn();
    const port = createObsidianVault(surface);
    const d = port.onChange(spy);
    d();
    surface.emit("create", file("a.md", "md"));
    expect(spy).not.toHaveBeenCalled();
  });
});
