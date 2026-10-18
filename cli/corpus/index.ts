import { CORPUS_LIMITS, permittedPath, type CorpusPolicy, type FrontmatterPort, type NoteSnapshot, type WorkspaceReadPort } from "../core/index.js";

export interface IndexedNote extends NoteSnapshot {
  readonly title: string; readonly description: string; readonly tags: readonly string[]; readonly aliases: readonly string[];
  readonly body: string; readonly bodyLine: number; readonly links: readonly string[];
}
export interface Passage {
  readonly id: string; readonly path: string; readonly startLine: number; readonly endLine: number;
  readonly text: string; readonly generation: string;
}
export interface Attention { readonly path: string; readonly reason: "metadata" | "unreadable" }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function strings(value: unknown, minimum: number, maximum: number, length: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(v => typeof v === "string" && v.trim().length > 0 && v.length <= length);
}
function words(text: string): readonly string[] { return text.toLocaleLowerCase("en").match(/[\p{L}\p{N}_-]+/gu) ?? []; }
export class Corpus {
  private notes = new Map<string, IndexedNote>();
  private attentionItems: Attention[] = [];
  private invalidated = true;
  private revision = 0;
  private graph = new Map<string, Set<string>>();
  constructor(private readonly reader: WorkspaceReadPort, private readonly parser: FrontmatterPort, private readonly policy: CorpusPolicy) {}
  invalidate(): void { this.invalidated = true; this.revision++; this.notes.clear(); this.graph.clear(); this.attentionItems = []; }
  get attention(): readonly Attention[] { return this.attentionItems; }
  async refresh(): Promise<void> {
    const revision = this.revision;
    const notes = new Map<string, IndexedNote>();
    const attention: Attention[] = [];
    let total = 0;
    for (const path of await this.reader.list()) {
      if (!permittedPath(path, this.policy)) continue;
      const snapshot = await this.reader.read(path);
      if (!snapshot) { attention.push({ path, reason: "unreadable" }); continue; }
      total += snapshot.text.length * 2;
      if (total > CORPUS_LIMITS.maxTotalBytes) throw new Error("workspace-capacity");
      const parsed = this.parser.parse(snapshot.text);
      if (!parsed || !record(parsed.fields)) { attention.push({ path, reason: "metadata" }); continue; }
      const { fields, body, bodyLine } = parsed;
      if (fields["synapse"] === "ignore" || fields["vault-synapse"] === "ignore" ||
        (Array.isArray(fields.tags) && fields.tags.some(tag => typeof tag === "string" && this.policy.excludedTags.includes(tag)))) continue;
      if (typeof fields.description !== "string" || !fields.description.trim() || fields.description.length > 240 ||
        !strings(fields.tags, 1, 12, 64) || !strings(fields.aliases, 0, 12, 80)) {
        attention.push({ path, reason: "metadata" }); continue;
      }
      const title = /^#\s+(.+)$/mu.exec(body)?.[1] ?? path.replace(/\.md$/iu, "").split("/").at(-1) ?? path;
      const links = [...body.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]|\[[^\]]*\]\(([^)\s]+)\)/gu)]
        .map(match => match[1] ?? match[2] ?? "").filter(link => !link.includes(":") && !link.startsWith("/") && !link.split("/").includes(".."));
      notes.set(path, { ...snapshot, title, description: fields.description, tags: fields.tags, aliases: fields.aliases, body, bodyLine, links });
    }
    if (revision !== this.revision) return;
    const graph = new Map<string, Set<string>>();
    for (const note of notes.values()) {
      const edges = graph.get(note.path) ?? new Set<string>();
      graph.set(note.path, edges);
      for (const raw of note.links) {
        const base = raw.split("#")[0] ?? "";
        const name = /\.md$/iu.test(base) ? base : `${base}.md`;
        const folder = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/") + 1) : "";
        const target = [folder + name, name].find(candidate => notes.has(candidate));
        if (!target || target === note.path) continue;
        edges.add(target);
        const backlinks = graph.get(target) ?? new Set<string>();
        backlinks.add(note.path); graph.set(target, backlinks);
      }
    }
    this.notes = notes; this.graph = graph; this.attentionItems = attention; this.invalidated = false;
  }
  async neighbors(path: string): Promise<readonly string[]> {
    await this.refresh();
    return this.invalidated ? [] : [...(this.graph.get(path) ?? [])].sort().slice(0, CORPUS_LIMITS.maxResults);
  }
  async recent(): Promise<readonly string[]> {
    await this.refresh();
    return this.invalidated ? [] : [...this.notes.values()].sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path))
      .slice(0, CORPUS_LIMITS.maxResults).map(note => note.path);
  }
  async search(query: string): Promise<readonly Passage[]> {
    // Watch events are hints: rescan on every public retrieval boundary.
    await this.refresh();
    if (this.invalidated) return [];
    const terms = [...new Set(words(query))].slice(0, 24);
    if (!terms.length) return [];
    const scored = [...this.notes.values()].map(note => {
      const titleTerms = words(`${note.title} ${note.description} ${note.tags.join(" ")} ${note.aliases.join(" ")}`);
      const bodyTerms = words(note.body);
      const score = terms.reduce((sum, term) => sum + (titleTerms.includes(term) ? 3 : 0) + (bodyTerms.includes(term) ? 1 : 0), 0);
      return { note, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path));
    return scored.slice(0, CORPUS_LIMITS.maxResults).map(({ note }) => {
      const lines = note.body.split("\n");
      const matching = lines.findIndex(line => words(line).some(word => terms.includes(word)));
      const start = Math.max(0, matching);
      const excerpt = lines.slice(start, start + CORPUS_LIMITS.passageLines);
      return { id: `${note.generation}:${start}`, path: note.path, startLine: note.bodyLine + start,
        endLine: note.bodyLine + start + excerpt.length - 1, text: excerpt.join("\n"), generation: note.generation };
    });
  }
  async resolve(passage: Passage): Promise<Passage | undefined> {
    await this.refresh();
    if (this.invalidated) return undefined;
    const note = this.notes.get(passage.path);
    if (!note || note.generation !== passage.generation || passage.startLine < note.bodyLine || passage.endLine < passage.startLine) return undefined;
    const lines = note.body.split("\n");
    const offset = passage.startLine - note.bodyLine;
    if (passage.endLine - note.bodyLine >= lines.length) return undefined;
    const text = lines.slice(offset, passage.endLine - note.bodyLine + 1).join("\n");
    return text === passage.text ? passage : undefined;
  }
}
