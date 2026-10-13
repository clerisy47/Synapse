/** Standalone Gate B harness; never imported by the production composition root. */
import { apiVersion, loadPdfJs, Modal, Notice, Plugin } from "obsidian";
import { asVaultPath, type VaultPort } from "../../core";
import { createObsidianNavigationFromApp, createObsidianVaultFromApp } from "./index";

const FIXTURES = ["text", "blank", "corrupt", "encrypted"] as const;
const PROBE_VAULT = "Synapse Gate B";
const HEARTBEAT_MS = 20;
const DEADLINE_MS = 30_000;
const MAX_PAGES = 10;
const PASSAGE = "Gate B passage\ncontinued on the next line";

type ProbeError = "PDF_ENCRYPTED" | "PDF_CORRUPT" | "PDFJS_UNAVAILABLE" | "FIXTURE_READ_FAILED" | "EXTRACTION_FAILED" | "TIMEOUT";
type Page = { getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void };
export type ProbeLoadingTask = {
  promise: Promise<{ numPages: number; getPage(page: number): Promise<Page> }>;
  destroy(): Promise<void>;
};
export type ProbePdfJs = {
  version: string;
  getDocument(options: { data: Uint8Array; verbosity: number }): ProbeLoadingTask;
};
export type ProbeTiming = {
  now(): number;
  every(callback: () => void, ms: number): () => void;
  later(callback: () => void, ms: number): () => void;
  yield(): Promise<void>;
};
export type GateBReport = {
  loaderMs: number;
  pdfjsVersion: string;
  maxEventLoopDelayMs: number;
  error?: ProbeError;
  fixtures: {
    fixture: typeof FIXTURES[number]; bytes: number; openMs: number;
    pageCount: number; truncated: boolean; pages: { page: number; chars: number; extractionMs: number }[];
    error?: ProbeError; cleanupFailed: boolean;
  }[];
};

function errorCode(error: unknown): ProbeError {
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : "";
  if (name === "PasswordException") return "PDF_ENCRYPTED";
  if (name === "InvalidPDFException") return "PDF_CORRUPT";
  if (name === "GateBTimeout") return "TIMEOUT";
  return "EXTRACTION_FAILED";
}

/** Only fixed fixture IDs and numeric summaries leave this runner. */
export async function runGateBProbe(
  load: () => Promise<ProbePdfJs>, vault: Pick<VaultPort, "readBinary">, timing: ProbeTiming,
  signal?: AbortSignal,
): Promise<GateBReport> {
  const report: GateBReport = { loaderMs: 0, pdfjsVersion: "unknown", maxEventLoopDelayMs: 0, fixtures: [] };
  const abortError = () => Object.assign(new Error(), { name: "GateBTimeout" });
  async function bounded<T>(work: () => Promise<T>, observeAbort = true): Promise<T> {
    if (observeAbort && signal?.aborted) throw abortError();
    let cancelTimer = () => {};
    let onAbort = () => {};
    const stop = new Promise<never>((_resolve, reject) => {
      cancelTimer = timing.later(() => reject(abortError()), DEADLINE_MS);
      onAbort = () => reject(abortError());
      if (observeAbort) signal?.addEventListener("abort", onAbort, { once: true });
    });
    try { return await Promise.race([work(), stop]); }
    finally { cancelTimer(); signal?.removeEventListener("abort", onAbort); }
  }
  let lastTick = timing.now();
  const stopHeartbeat = timing.every(() => {
    const now = timing.now();
    report.maxEventLoopDelayMs = Math.max(report.maxEventLoopDelayMs, now - lastTick - HEARTBEAT_MS, 0);
    lastTick = now;
  }, HEARTBEAT_MS);
  try {
    let pdfjs: ProbePdfJs;
    const start = timing.now();
    try {
      pdfjs = await bounded(load);
      if (typeof pdfjs.getDocument !== "function") throw new Error();
      // Never copy arbitrary module strings into diagnostics.
      report.pdfjsVersion = /^\d+\.\d+\.\d+$/.test(pdfjs.version) ? pdfjs.version : "unknown";
    } catch (error) {
      report.error = errorCode(error) === "TIMEOUT" ? "TIMEOUT" : "PDFJS_UNAVAILABLE";
      return report;
    } finally { report.loaderMs = timing.now() - start; }
    for (const fixture of FIXTURES) {
      if (signal?.aborted) break;
      const row: GateBReport["fixtures"][number] = {
        fixture, bytes: 0, openMs: 0, pageCount: 0, truncated: false, pages: [], cleanupFailed: false,
      };
      report.fixtures.push(row);
      let task: ProbeLoadingTask | undefined;
      let read = true;
      try {
        const bytes = await bounded(() => vault.readBinary(asVaultPath(`${fixture}.pdf`)));
        row.bytes = bytes.byteLength;
        read = false;
        const openStart = timing.now();
        const doc = await bounded(() => {
          task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
          return task.promise;
        }).finally(() => { row.openMs = timing.now() - openStart; });
        row.pageCount = doc.numPages;
        row.truncated = doc.numPages > MAX_PAGES;
        for (let page = 1; page <= Math.min(doc.numPages, MAX_PAGES); page++) {
          const pageStart = timing.now();
          const handle = await bounded(() => doc.getPage(page));
          try {
            const content = await bounded(() => handle.getTextContent());
            const chars = content.items.reduce<number>((sum, item) => {
              if (typeof item !== "object" || item === null || !("str" in item) || typeof item.str !== "string") return sum;
              return sum + item.str.replace(/\s/g, "").length;
            }, 0);
            row.pages.push({ page, chars, extractionMs: timing.now() - pageStart });
          } finally { handle.cleanup(); }
          await timing.yield();
        }
      } catch (error) {
        const code = errorCode(error);
        row.error = code === "TIMEOUT" ? code : read ? "FIXTURE_READ_FAILED" : code;
      }
      finally {
        if (task) {
          try { await bounded(() => task!.destroy(), false); }
          catch { row.cleanupFailed = true; }
        }
      }
    }
    // Let the heartbeat observe blocking in the final extraction/cleanup, too.
    await timing.yield();
    return report;
  } finally { stopHeartbeat(); }
}

export type GateBLabels = {
  run: string; pdf: string; note: string; report: string;
  wrongVault: string; busy: string; failed: string;
};

/** Composition is supplied by the independent spike entrypoint. */
export function createGateBPlugin(labels: GateBLabels) {
  return class GateBPlugin extends Plugin {
    private active: AbortController | null = null;
    private disposed = false;
    onload(): void {
      this.disposed = false;
      const ready = () => {
        if (this.app.vault.getName() !== PROBE_VAULT) { new Notice(labels.wrongVault); return false; }
        return !this.disposed;
      };
      this.addCommand({ id: "extract", name: labels.run, callback: async () => {
        if (!ready()) return;
        if (this.active) { new Notice(labels.busy); return; }
        const controller = new AbortController();
        this.active = controller;
        try {
          const report = await runGateBProbe(() => loadPdfJs() as Promise<ProbePdfJs>, createObsidianVaultFromApp(this.app), {
            now: () => performance.now(),
            every: (cb, ms) => { const id = window.setInterval(cb, ms); return () => window.clearInterval(id); },
            later: (cb, ms) => { const id = window.setTimeout(cb, ms); return () => window.clearTimeout(id); },
            yield: () => new Promise(resolve => window.setTimeout(resolve, HEARTBEAT_MS)),
          }, controller.signal);
          if (this.disposed || controller.signal.aborted) return;
          const modal = new Modal(this.app);
          modal.titleEl.textContent = labels.report;
          const pre = modal.contentEl.createEl("pre");
          pre.textContent = JSON.stringify({ obsidianVersion: /^\d+\.\d+\.\d+$/.test(apiVersion) ? apiVersion : "unknown", ...report }, null, 2);
          modal.open();
          this.register(() => modal.close());
        } catch { if (!this.disposed) new Notice(labels.failed); }
        finally { this.active = null; }
      }});
      const navigation = createObsidianNavigationFromApp(this.app, (text, quote, hint) => {
        const starts: number[] = [];
        for (let pos = text.indexOf(quote); pos >= 0; pos = text.indexOf(quote, pos + 1)) starts.push(pos);
        const start = starts.sort((a, b) => Math.abs(a - hint) - Math.abs(b - hint))[0];
        return start === undefined ? null : { start, end: start + quote.length };
      });
      for (const [id, name, target] of [
        ["pdf-page-3", labels.pdf, { path: asVaultPath("text.pdf"), page: 3 }],
        ["note-passage", labels.note, { path: asVaultPath("passage.md"), quote: PASSAGE, start: 0 }],
      ] as const) this.addCommand({ id, name, callback: async () => {
        if (!ready()) return;
        try { await navigation.openAt(target); }
        catch { if (!this.disposed) new Notice(labels.failed); }
      }});
    }
    onunload(): void { this.disposed = true; this.active?.abort(); }
  };
}
