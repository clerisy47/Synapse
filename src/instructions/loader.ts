import { parseDocument } from "yaml";
import { CONTROL_LIMITS } from "../constants";
import { contentHash, createObservable, type ControlPaths, type InstructionSnapshot, type PolicySnapshot, type VaultPort, type Observable } from "../core";
import { parseSecurityRules } from "../policy";
import { parseRoutingSettings } from "./contracts";

export type ControlFileState<T> = { readonly status: "loading" | "missing" | "invalid" | "unavailable"; readonly snapshot?: never } | { readonly status: "ready"; readonly snapshot: T };
export interface ControlState {
  readonly revision: number;
  readonly instructions: ControlFileState<InstructionSnapshot>;
  readonly security: ControlFileState<PolicySnapshot>;
}
export interface StarterChange { readonly path: string; readonly before: ""; readonly after: string; readonly expectedAbsent: true }
export interface ControlStore {
  readonly status: Observable<ControlState>;
  reload(): Promise<void>;
  /** Review data only; never grants write authority. Recheck absence at apply in R3-T04. */
  proposeSetup(): Promise<readonly StarterChange[]>;
  dispose(): void;
}

/** Parse exact file frontmatter, rejecting duplicate keys, aliases and unsupported tags. */
function frontmatter(text: string): { data: unknown; prose: string } | null {
  if (text.length > CONTROL_LIMITS.markdownChars) return null;
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    const document = parseDocument(match[1], { uniqueKeys: true, schema: "core" });
    if (document.errors.length || document.warnings.length) return null;
    return { data: document.toJS({ maxAliasCount: 0 }), prose: text.slice(match[0].length) };
  } catch { return null; }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createControlStore(deps: { vault: VaultPort; paths: ControlPaths; starters: { instructions: string; security: string } }): ControlStore {
  const { vault, paths } = deps;
  let epoch = 0;
  let disposed = false;
  const state = createObservable<ControlState>({ revision: epoch, instructions: { status: "loading" }, security: { status: "loading" } });
  const restricted = [paths.instructions, paths.security, paths.research].map((path) => path.toLowerCase());
  async function load<K extends "instructions" | "security">(kind: K): Promise<ControlState[K]> {
    try {
      const files = await vault.listFiles();
      const matches = files.filter((file) => file.path.toLowerCase() === paths[kind].toLowerCase());
      if (!matches.length) return { status: "missing" };
      if (matches.length !== 1 || matches[0].path !== paths[kind]) return { status: "invalid" };
      const text = await vault.readText(paths[kind]);
      const parsed = frontmatter(text);
      if (!parsed) return { status: "invalid" };
      const hashed = await contentHash(text);
      if (!hashed.ok) return { status: "unavailable" };
      const hash = hashed.value;
      if (kind === "security") {
        const rules = parseSecurityRules(parsed.data);
        return (rules.ok ? { status: "ready", snapshot: freeze({ version: 1, hash, rules: rules.value }) } : { status: "invalid" }) as ControlState[K];
      }
      const routing = parseRoutingSettings(parsed.data);
      if (!routing.ok || routing.value.destinations.some((d) => restricted.includes(d.path.toLowerCase())) || restricted.some((path) => path.startsWith(`${routing.value.daily.folder.toLowerCase()}/`))) return { status: "invalid" };
      return { status: "ready", snapshot: freeze({ version: 1, hash, routing: routing.value, prose: parsed.prose }) } as ControlState[K];
    } catch { return { status: "unavailable" }; }
  }
  async function reload(): Promise<void> {
    if (disposed) return;
    const generation = ++epoch;
    // Synchronous invalidation: consumers cannot reuse a previously valid snapshot during I/O.
    state.set({ revision: generation, instructions: { status: "loading" }, security: { status: "loading" } });
    const [instructions, security] = await Promise.all([load("instructions"), load("security")]);
    if (!disposed && generation === epoch) state.set(freeze({ revision: generation, instructions, security }));
  }
  const unsubscribe = vault.onChange((event) => {
    const changed = event.type === "rename" ? [event.from, event.to] : [event.path];
    if (changed.some((path) => restricted.slice(0, 2).includes(path.toLowerCase()))) void reload();
  });
  return {
    status: state,
    reload,
    async proposeSetup() {
      const generation = epoch;
      const files = await vault.listFiles();
      if (disposed || generation !== epoch) return [];
      const occupied = new Set(files.map((file) => file.path.toLowerCase()));
      return freeze((["instructions", "security"] as const).filter((kind) => !occupied.has(paths[kind].toLowerCase())).map((kind) => ({ path: paths[kind], before: "" as const, after: deps.starters[kind], expectedAbsent: true as const })));
    },
    dispose() { disposed = true; ++epoch; unsubscribe(); state.set({ revision: epoch, instructions: { status: "unavailable" }, security: { status: "unavailable" } }); },
  };
}
