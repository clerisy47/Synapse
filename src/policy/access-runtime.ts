import { createObservable, stableStringify, type AccessContext, type ControlPaths, type Disposable, type DocMeta, type MetadataPort, type Observable, type PolicySnapshot, type VaultPath, type VaultPort } from "../core";
import type { ExclusionPolicy } from "./exclusion";
import { createReadSession, type ReadSession } from "./read-session";

let runtimeSerial = 0;
export interface AccessRuntime {
  readonly changes: Observable<number>;
  open(context: AccessContext, projection: "raw-tools" | "evidence"): ReadSession;
  version(): string;
  internalCount(): number;
  dispose(): void;
}

/** Events invalidate synchronously, before any asynchronous corpus/control reload. */
export function createAccessRuntime(opts: {
  vault: VaultPort; metadata: MetadataPort; paths: ControlPaths; exclusion: ExclusionPolicy;
  policy(): PolicySnapshot | null;
  subscribePolicy(callback: () => void): Disposable;
  getDoc(path: VaultPath): DocMeta | null;
  listDocs(): readonly DocMeta[];
  getFrontmatter(path: VaultPath): Readonly<Record<string, unknown>> | null;
}): AccessRuntime {
  const serial = ++runtimeSerial;
  const changes = createObservable(0);
  const dirty = new Set<VaultPath>();
  let disposed = false;
  const invalidate = () => changes.set(changes.get() + 1);
  const subscriptions = [
    opts.vault.onChange((event) => {
      for (const path of event.type === "rename" ? [event.from, event.to] : [event.path]) dirty.add(path);
      invalidate();
    }),
    opts.metadata.onChanged((path) => { dirty.delete(path); invalidate(); }),
    opts.metadata.onResolved(() => { dirty.clear(); invalidate(); }),
    opts.subscribePolicy(invalidate),
  ];
  const version = () => `${serial}:${changes.get()}:${opts.policy()?.hash ?? "unavailable"}`;
  function getDoc(path: VaultPath): DocMeta | null {
    if (disposed || dirty.has(path)) return null;
    const doc = opts.getDoc(path);
    const metadata = opts.metadata.get(path);
    if (!doc || !metadata || opts.exclusion.decide(path, metadata.tags, metadata.frontmatter, { kind: "note" }) === "excluded") return null;
    const aliases = metadata.frontmatter.aliases ?? metadata.frontmatter.alias;
    const currentAliases = typeof aliases === "string" ? [aliases.trim()].filter(Boolean) : Array.isArray(aliases) ? aliases.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];
    // A fresh metadata event can precede asynchronous corpus publication. Never
    // combine new authorization metadata with old tool-visible fields.
    try {
      const cached = opts.getFrontmatter(path);
      if (cached === null || stableStringify(cached) !== stableStringify(metadata.frontmatter)
        || stableStringify([...doc.tags].sort()) !== stableStringify([...metadata.tags].sort())
        || stableStringify([...doc.aliases].sort()) !== stableStringify([...currentAliases].sort())) return null;
    } catch { return null; }
    return { ...doc, tags: [...metadata.tags], aliases: currentAliases };
  }
  return {
    changes, version,
    open(context, projection) {
      return createReadSession({ context, projection, version, paths: opts.paths,
        policy: () => disposed ? null : opts.policy(), getDoc, listDocs: () => opts.listDocs().filter((doc) => getDoc(doc.ref.path) !== null),
        getFrontmatter: (path) => getDoc(path) ? opts.metadata.get(path)?.frontmatter ?? null : null,
      });
    },
    internalCount() {
      const policy = opts.policy();
      if (disposed || !policy) return 0;
      const session = createReadSession({ context: { recipient: "internal", purpose: "search", policyHash: policy.hash },
        projection: "raw-tools", version, paths: opts.paths, policy: () => opts.policy(), getDoc,
        listDocs: () => opts.listDocs(), getFrontmatter: (path) => getDoc(path) ? opts.metadata.get(path)?.frontmatter ?? null : null });
      return opts.listDocs().filter((doc) => session.allows(doc.ref.path)).length;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of subscriptions) unsubscribe();
      invalidate(); dirty.clear();
    },
  };
}
