import { constants, watch } from "node:fs";
import { open, opendir, lstat, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { CORPUS_LIMITS, permittedPath, type CorpusPolicy, type WorkspaceReadPort } from "../../core/index.js";

export function createReader(root: string, policy: CorpusPolicy): WorkspaceReadPort {
  async function resolve(path: string): Promise<string | undefined> {
    if (!permittedPath(path, policy)) return undefined;
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) return undefined;
    }
    const canonical = await realpath(current);
    const local = relative(root, canonical);
    if (local.startsWith("..") || isAbsolute(local)) return undefined;
    return canonical;
  }
  return {
    async list() {
      const paths: string[] = [];
      let entries = 0;
      async function visit(directory: string, prefix: string, depth: number): Promise<void> {
        if (depth > CORPUS_LIMITS.maxDepth) throw new Error("workspace-capacity");
        const before = await lstat(directory);
        if (!before.isDirectory() || before.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("workspace-changed");
        const contents = await opendir(directory);
        for await (const entry of contents) {
          if (++entries > CORPUS_LIMITS.maxVisitedEntries) throw new Error("workspace-capacity");
          if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (policy.excludedFolders.some(folder => path === folder || path.startsWith(`${folder}/`))) continue;
          if (entry.isDirectory()) {
            const info = await lstat(join(root, path));
            if (!info.isSymbolicLink()) await visit(join(root, path), path, depth + 1);
          } else if (entry.isFile() && permittedPath(path, policy)) {
            if (paths.length >= CORPUS_LIMITS.maxFiles) throw new Error("workspace-capacity");
            paths.push(path);
          }
        }
        const after = await lstat(directory);
        if (before.ino !== after.ino || before.dev !== after.dev || after.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("workspace-changed");
      }
      await visit(root, "", 0);
      return paths.sort();
    },
    async read(path) {
      let file;
      try {
        const target = await resolve(path);
        if (!target) return undefined;
        file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const before = await file.stat();
        if (!before.isFile() || before.size > CORPUS_LIMITS.maxFileBytes) return undefined;
        const bytes = Buffer.alloc(CORPUS_LIMITS.maxFileBytes + 1);
        let length = 0;
        while (length < bytes.length) {
          const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length > CORPUS_LIMITS.maxFileBytes) return undefined;
        const after = await file.stat();
        const current = await resolve(path);
        if (!current || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return undefined;
        const atPath = await lstat(current);
        if (atPath.ino !== after.ino || atPath.dev !== after.dev) return undefined;
        const data = bytes.subarray(0, length);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
        return { path, text, modifiedAt: after.mtimeMs, generation: createHash("sha256").update(data).digest("hex") };
      } catch { return undefined; }
      finally { await file?.close(); }
    },
    watch(invalidate) {
      const watcher = watch(root, { recursive: true }, () => { invalidate(); });
      watcher.on("error", invalidate);
      return () => { watcher.close(); };
    },
  };
}
