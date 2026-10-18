import { parseDocument } from "yaml";
import { CONTROL_LIMITS } from "../constants";
import { contentHash, createObservable, type ControlPaths, type InstructionSnapshot, type VaultPort, type Observable } from "../core";
import { parseRoutingSettings } from "./contracts";

export type ControlFileState<T> = { readonly status: "loading" | "missing" | "invalid" | "unavailable"; readonly snapshot?: never } | { readonly status: "ready"; readonly snapshot: T };
export interface ControlState {
  readonly revision: number;
  readonly instructions: ControlFileState<InstructionSnapshot>;
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

export function createControlStore(deps: { vault: VaultPort; paths: ControlPaths; starters: { instructions: string } }): ControlStore {
  const { vault, paths } = deps;
  let epoch = 0;
  let disposed = false;
  const state = createObservable<ControlState>({ revision: epoch, instructions: { status: "loading" } });
  const restricted = [paths.instructions, paths.research].map((path) => path.toLowerCase());
  async function load(): Promise<ControlFileState<InstructionSnapshot>> {
    try {
      const files = await vault.listFiles();
      const matches = files.filter((file) => file.path.toLowerCase() === paths.instructions.toLowerCase());
      if (!matches.length) return { status: "missing" };
      if (matches.length !== 1 || matches[0].path !== paths.instructions) return { status: "invalid" };
      const text = await vault.readText(paths.instructions);
      const parsed = frontmatter(text);
      if (!parsed) return { status: "invalid" };
      const hashed = await contentHash(text);
      if (!hashed.ok) return { status: "unavailable" };
      const hash = hashed.value;

      const routing = parseRoutingSettings(parsed.data);
      if (!routing.ok || routing.value.destinations.some((d) => restricted.includes(d.path.toLowerCase())) || restricted.some((path) => path.startsWith(`${routing.value.daily.folder.toLowerCase()}/`))) return { status: "invalid" };
      return { status: "ready", snapshot: freeze({ version: 1, hash, routing: routing.value, prose: parsed.prose }) };
    } catch { return { status: "unavailable" }; }
  }
  async function reload(): Promise<void> {
    if (disposed) return;
    const generation = ++epoch;
    // Synchronous invalidation: consumers cannot reuse a previously valid snapshot during I/O.
    state.set({ revision: generation, instructions: { status: "loading" } });
    const instructions = await load();
    if (!disposed && generation === epoch) state.set(freeze({ revision: generation, instructions }));
  }
  const unsubscribe = vault.onChange((event) => {
    const changed = event.type === "rename" ? [event.from, event.to] : [event.path];
    if (changed.some((path) => path.toLowerCase() === paths.instructions.toLowerCase())) void reload();
  });
  return {
    status: state,
    reload,
    async proposeSetup() {
      const generation = epoch;
      const files = await vault.listFiles();
      if (disposed || generation !== epoch) return [];
      const occupied = new Set(files.map((file) => file.path.toLowerCase()));
      return freeze(occupied.has(paths.instructions.toLowerCase()) ? [] : [{ path: paths.instructions, before: "" as const, after: deps.starters.instructions, expectedAbsent: true as const }]);
    },
    dispose() { disposed = true; ++epoch; unsubscribe(); state.set({ revision: epoch, instructions: { status: "unavailable" } }); },
  };
}
