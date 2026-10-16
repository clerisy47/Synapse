import { bodyStartOffset, ok, type Excerpt, type McpResult, type VaultPath } from "../core";
import { createQaPipeline } from "../agent";
import { COLLABORATION_LIMITS as L } from "../constants";
import { controlsCurrent, type Client, type CollaborationEnvironment } from "./service";

/** Remote and external projections are separate grants; neither implies the other. */
export async function query(e: CollaborationEnvironment, client: Client, args: { question: string }, signal: AbortSignal, id: () => string): Promise<McpResult> {
  const no = (): McpResult => ({ status: "unavailable" });
  const version = e.access.version();
  const sessions = [
    e.access.open({ recipient: "internal", purpose: "search", policyHash: e.policy.hash }, "evidence"),
    e.access.open({ recipient: "remote-model", purpose: "search", policyHash: e.policy.hash }, "evidence"),
    e.access.open({ recipient: "external-client", purpose: "query", policyHash: e.policy.hash, clientId: client.id, capabilities: client.scopes }, "evidence"),
  ];
  const current = () => !signal.aborted && e.access.version() === version && sessions.every((s) => s.current());
  if (!current() || !await controlsCurrent(e)) return no();
  // Suppress known metadata even when echoed in prose or supplied by the caller.
  const metadata = new Set<string>();
  for (const file of await e.vault.listFiles()) {
    for (const part of [file.path, ...file.path.split("/"), file.path.split("/").pop()?.replace(/\.md$/i, "")]) if (part) metadata.add(part);
    const fm = e.metadata.get(file.path)?.frontmatter;
    for (const field of [fm?.title, fm?.alias, fm?.aliases]) {
      if (typeof field === "string" && field) metadata.add(field);
      if (Array.isArray(field)) for (const value of field) if (typeof value === "string" && value) metadata.add(value);
    }
    const doc = e.tools.getDoc(file.path);
    if (doc) for (const value of [doc.title, ...doc.aliases]) if (value) metadata.add(value);
  }
  const values = [...metadata].sort((a, b) => b.length - a.length);
  const sanitize = (input: string) => {
    let text = sessions.reduce((text, session) => session.sanitize(text), input);
    for (const value of values) {
      // Fixed literal comparison: no model/client-controlled regular expressions.
      const needle = value.toLowerCase();
      if (text.toLowerCase().length === text.length && needle.length === value.length) {
        let at = text.toLowerCase().indexOf(needle);
        while (at >= 0) { text = text.slice(0, at) + text.slice(at + value.length); at = text.toLowerCase().indexOf(needle); }
      } else {
        // Unicode case expansion (e.g. İ) changes folded offsets. Compare at
        // original offsets so removal always advances and cannot miss a title.
        for (let at = 0; at <= text.length - value.length;) {
          if (text.slice(at, at + value.length).toLowerCase() === needle) { text = text.slice(0, at) + text.slice(at + value.length); at = 0; }
          else at++;
        }
      }
    }
    return text;
  };
  const sources = new Map<VaultPath, string>();
  const access = {
    version, current, sanitize,
    allows: (path: VaultPath) => current() && sessions.every((s) => s.allows(path)),
    remember(path: VaultPath, text: string) { sources.set(path, text); for (const session of sessions) session.remember(path, text); },
    project(excerpt: Excerpt) {
      const source = sources.get(excerpt.ref.path);
      if (!current() || source === undefined || !sessions.every((s) => s.allows(excerpt.ref.path))) return null;
      const start = Math.max(bodyStartOffset(source), excerpt.locator.start);
      if (start >= excerpt.locator.end) return null;
      const body = { ...excerpt, text: source.slice(start, excerpt.locator.end), locator: { ...excerpt.locator, start } };
      // All sessions must independently recognize the exact source slice.
      const views = sessions.map((s) => s.project(body));
      if (views.some((v) => !v)) return null;
      return { title: "Source", text: sanitize(views[2]!.text) };
    },
  };
  const job = e.jobs.submit<McpResult>({ kind: "mcp", label: "MCP query", async run(ctx) {
    if (!current() || !await controlsCurrent(e)) return ok(no());
    const result = await createQaPipeline({ access, tools: e.registry(access), multiTurn: false,
      model: { generate: (request, requestSignal) => e.model.generate({ ...request, isCurrent: () => current() && (request.isCurrent?.() ?? true) }, requestSignal) },
      readText: async (path) => access.allows(path) ? e.tools.readText(path) : null,
    }).run({ question: sanitize(args.question), history: [] }, ctx, () => {});
    if (!result.ok || result.value.status !== "answered" || !current() || !await controlsCurrent(e)) return ok(no());
    const references: { id: string; label: string; excerpt: string }[] = [];
    const seen = new Set<string>();
    for (const claim of result.value.claims) for (const citation of claim.citations) {
      if (citation.status !== "sourced") continue;
      const view = access.project(citation.excerpt);
      const text = view ? [...view.text.trim()].slice(0, L.excerptPoints).join("") : "";
      if (!text || seen.has(text) || references.length >= L.references) continue;
      seen.add(text);
      const opaque = id(); if (!/^[A-Za-z0-9_-]{22}$/.test(opaque)) return ok(no());
      references.push({ id: `ref_${opaque}`, label: `Source ${references.length + 1}`, excerpt: text });
    }
    if (!references.length || !current()) return ok(no());
    // Conservative extractive answer: generated prose cannot prove absence of
    // forbidden metadata/hallucinated private facts. Only projected evidence leaves.
    const answer = [...references.map((r) => r.excerpt).join("\n\n")].slice(0, L.answerPoints).join("");
    return ok({ status: "answered", answer, references });
  } });
  const cancel = () => job.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) job.cancel();
  try {
    const result = await job.result;
    if (!result.ok || !current() || !await controlsCurrent(e)) return no();
    for (const [path, text] of sources) if (!access.allows(path) || await e.vault.readText(path) !== text) return no();
    return current() ? result.value : no();
  }
  finally { signal.removeEventListener("abort", cancel); sources.clear(); }
}
