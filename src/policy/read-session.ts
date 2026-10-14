import type { AccessContext, ControlPaths, DocMeta, Excerpt, PolicySnapshot, VaultPath } from "../core";
import { evaluateAccessContract, type AccessDecision } from "./recipient-contract";
import { projectDisclosure, redactValues, removedValues, replaceLiterals, type DisclosureExcerpt } from "./disclosure";

export interface ReadSession {
  readonly version: string;
  current(): boolean;
  allows(path: VaultPath): boolean;
  remember(path: VaultPath, source: string): void;
  project(excerpt: Excerpt): DisclosureExcerpt | null;
  sanitize(text: string): string;
}
export interface ReadSessionOptions {
  context: AccessContext;
  policy(): PolicySnapshot | null;
  /** Changes synchronously for source, metadata, exclusion and control edits. */
  version(): string;
  paths: ControlPaths;
  getDoc(path: VaultPath): DocMeta | null;
  listDocs(): readonly DocMeta[];
  getFrontmatter(path: VaultPath): Readonly<Record<string, unknown>> | null;
  /** Raw path-based tool representations cannot implement field masks. */
  projection: "raw-tools" | "evidence";
}

export function createReadSession(opts: ReadSessionOptions): ReadSession {
  const version = opts.version();
  const sources = new Map<VaultPath, string>();
  const removals = new Set<string>();
  const current = () => opts.version() === version && opts.policy()?.hash === opts.context.policyHash;
  function decision(path: VaultPath): AccessDecision {
    if (!current()) return { effect: "deny", reason: "stale-policy" };
    const doc = opts.getDoc(path);
    const result = evaluateAccessContract(opts.policy(), {
      context: opts.context, operation: "read", path, excluded: doc === null,
      tags: doc?.tags ?? null, frontmatter: opts.getFrontmatter(path), controlPaths: opts.paths,
      maskingSupported: opts.projection === "evidence",
    });
    if (result.effect === "mask" && doc) {
      for (const value of removedValues(doc, opts.getFrontmatter(path) ?? {}, result.masks)) removals.add(value);
    }
    return result;
  }
  // Initialize known field redactions before even a planning/history request.
  for (const doc of opts.listDocs()) decision(doc.ref.path);
  return {
    version, current,
    allows: (path) => decision(path).effect !== "deny",
    remember(path, source) { if (current()) sources.set(path, source); },
    project(excerpt) {
      const access = decision(excerpt.ref.path);
      const doc = opts.getDoc(excerpt.ref.path);
      const fm = opts.getFrontmatter(excerpt.ref.path);
      const source = sources.get(excerpt.ref.path);
      if (access.effect === "deny" || !doc || fm === null || source === undefined || source.slice(excerpt.locator.start, excerpt.locator.end) !== excerpt.text) return null;
      const masks = access.effect === "mask" ? access.masks : [];
      for (const value of removedValues(doc, fm, masks)) removals.add(value);
      const view = projectDisclosure(excerpt, doc, fm, source, masks);
      const redact = (text: string) => redactValues(text, [...removals].sort((a, b) => b.length - a.length));
      return { title: redact(view.title), text: redact(view.text), ...(view.heading === undefined ? {} : { heading: redact(view.heading) }) };
    },
    sanitize(text) {
      if (!current()) return "";
      // Applying literal rules conservatively across free text also covers questions,
      // retry feedback and model-generated strings without trusting their provenance.
      const masks = opts.policy()!.rules.rules.flatMap((r) => r.recipient === opts.context.recipient && r.operation === "read" && r.effect === "mask" ? [...r.masks!] : []);
      const values = [...removals].sort((a, b) => b.length - a.length);
      return redactValues(replaceLiterals(redactValues(text, values), masks), values);
    },
  };
}

/** Retrieval needs local permission as well as the eventual recipient's grant. */
export function intersectReadSessions(internal: ReadSession, recipient: ReadSession): ReadSession {
  return {
    version: recipient.version,
    current: () => internal.current() && recipient.current(),
    allows: (path) => internal.allows(path) && recipient.allows(path),
    remember(path, text) { internal.remember(path, text); recipient.remember(path, text); },
    project: (excerpt) => internal.allows(excerpt.ref.path) ? recipient.project(excerpt) : null,
    sanitize: (text) => internal.current() ? recipient.sanitize(text) : "",
  };
}
