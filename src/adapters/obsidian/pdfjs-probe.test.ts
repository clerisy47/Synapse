import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, Plugin, PluginManifest } from "obsidian";
import { createGateBPlugin, runGateBProbe, type ProbePdfJs, type ProbeTiming } from "./pdfjs-probe";

function setup() {
  let clock = 0;
  let tick = () => {};
  const stopHeartbeat = vi.fn();
  const scheduleTimeout = setTimeout;
  const cancelTimeout = clearTimeout;
  const timing: ProbeTiming = {
    now: () => clock,
    every: cb => { tick = cb; return stopHeartbeat; },
    later: (cb, ms) => { const id = scheduleTimeout(cb, ms); return () => cancelTimeout(id); },
    yield: async () => { clock += 25; tick(); },
  };
  const cleanup = vi.fn();
  const page = { cleanup, getTextContent: vi.fn(async () => {
    clock += 7;
    return { items: [{ str: "private synthetic text" }, { type: "marked-content" }, { str: " \n" }] };
  }) };
  const getPage = vi.fn(async () => { clock += 3; return page; });
  const doc = { numPages: 3, getPage };
  const destroy = vi.fn(async () => {});
  const getDocument = vi.fn<ProbePdfJs["getDocument"]>(() => ({ promise: Promise.resolve(doc), destroy }));
  const pdfjs: ProbePdfJs = { version: "4.1.392", getDocument };
  const vault = { readBinary: vi.fn(async () => new ArrayBuffer(12)) };
  const load = vi.fn(async () => { clock += 2; return pdfjs; });
  return { timing, stopHeartbeat, cleanup, page, getPage, doc, destroy, getDocument, pdfjs, vault, load };
}

afterEach(() => { vi.useRealTimers(); });

describe("Gate B extraction harness", () => {
  it("measures every page, yields, and emits only counts and fixed labels", async () => {
    const f = setup();
    const report = await runGateBProbe(f.load, f.vault, f.timing);
    expect(report.loaderMs).toBe(2);
    expect(report.pdfjsVersion).toBe("4.1.392");
    expect(report.maxEventLoopDelayMs).toBeGreaterThan(0);
    expect(report.fixtures.map(row => row.fixture)).toEqual(["text", "blank", "corrupt", "encrypted"]);
    expect(report.fixtures[0]).toMatchObject({ bytes: 12, pageCount: 3, truncated: false, cleanupFailed: false });
    expect(report.fixtures[0]?.pages).toEqual([1, 2, 3].map(page => ({ page, chars: 20, extractionMs: 10 })));
    expect(f.cleanup).toHaveBeenCalledTimes(12);
    expect(f.destroy).toHaveBeenCalledTimes(4);
    expect(f.stopHeartbeat).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain("private");
    expect(JSON.stringify(report)).not.toContain(".pdf");
    expect(f.getDocument.mock.calls[0]?.[0]).toMatchObject({ data: new Uint8Array(12), verbosity: 0 });
  });

  it("keeps blank pages at zero characters and caps extraction with an explicit truncation flag", async () => {
    const f = setup();
    f.doc.numPages = 11;
    f.page.getTextContent.mockResolvedValue({ items: [{ str: " \n\t" }] });
    const report = await runGateBProbe(f.load, f.vault, f.timing);
    expect(report.fixtures[0]).toMatchObject({ pageCount: 11, truncated: true });
    expect(report.fixtures[0]?.pages).toHaveLength(10);
    expect(report.fixtures[0]?.pages.every(page => page.chars === 0)).toBe(true);
  });

  it.each([["PasswordException", "PDF_ENCRYPTED"], ["InvalidPDFException", "PDF_CORRUPT"], ["secret filename.pdf", "EXTRACTION_FAILED"]])(
    "sanitizes %s and destroys failed loading tasks", async (name, code) => {
      const f = setup();
      f.getDocument.mockImplementation(() => ({ promise: Promise.reject(Object.assign(new Error("secret note body and API key"), { name })), destroy: f.destroy }));
      const report = await runGateBProbe(f.load, f.vault, f.timing);
      expect(report.fixtures.every(row => row.error === code)).toBe(true);
      expect(f.destroy).toHaveBeenCalledTimes(4);
      expect(JSON.stringify(report)).not.toContain("secret");
      expect(f.stopHeartbeat).toHaveBeenCalledOnce();
    },
  );

  it("cleans pages and tasks after text extraction fails, continuing to the next fixture", async () => {
    const f = setup();
    f.page.getTextContent.mockRejectedValueOnce(new Error("private note text"));
    f.destroy.mockRejectedValueOnce(new Error("private cleanup detail"));
    const report = await runGateBProbe(f.load, f.vault, f.timing);
    expect(report.fixtures[0]).toMatchObject({ error: "EXTRACTION_FAILED", cleanupFailed: true });
    expect(report.fixtures[1]?.pages).toHaveLength(3);
    expect(f.cleanup).toHaveBeenCalledTimes(10);
    expect(f.destroy).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("reports unavailable PDF.js without reading fixtures and always stops the heartbeat", async () => {
    const f = setup();
    const report = await runGateBProbe(async () => { throw new Error("private"); }, f.vault, f.timing);
    expect(report.error).toBe("PDFJS_UNAVAILABLE");
    expect(report.fixtures).toEqual([]);
    expect(f.vault.readBinary).not.toHaveBeenCalled();
    expect(f.stopHeartbeat).toHaveBeenCalledOnce();
  });

  it("sanitizes invalid version strings and distinguishes unreadable fixtures", async () => {
    const f = setup();
    f.pdfjs.version = "private";
    f.vault.readBinary.mockRejectedValueOnce(new Error("private path"));
    const report = await runGateBProbe(f.load, f.vault, f.timing);
    expect(report.pdfjsVersion).toBe("unknown");
    expect(report.fixtures[0]?.error).toBe("FIXTURE_READ_FAILED");
    expect(report.fixtures[1]?.error).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("times out a hung loader and clears the deadline timer", async () => {
    vi.useFakeTimers();
    const f = setup();
    const result = runGateBProbe(() => new Promise(() => {}), f.vault, f.timing);
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await result).error).toBe("TIMEOUT");
    expect(f.stopHeartbeat).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("destroys a hung loading task on cancellation and starts no more fixtures", async () => {
    const f = setup();
    const controller = new AbortController();
    f.getDocument.mockImplementation(() => {
      queueMicrotask(() => controller.abort());
      return { promise: new Promise(() => {}), destroy: f.destroy };
    });
    const report = await runGateBProbe(f.load, f.vault, f.timing, controller.signal);
    expect(report.fixtures).toHaveLength(1);
    expect(report.fixtures[0]).toMatchObject({ error: "TIMEOUT", cleanupFailed: false });
    expect(f.destroy).toHaveBeenCalledOnce();
    expect(f.stopHeartbeat).toHaveBeenCalledOnce();
  });

  it("loads and registers commands without loading PDF.js or reading a vault", async () => {
    const ProbePlugin = createGateBPlugin({ run: "run", pdf: "pdf", note: "note", report: "report", wrongVault: "wrong vault", busy: "busy", failed: "failed" });
    const plugin = new ProbePlugin({} as App, {} as PluginManifest);
    const commands: { id: string; callback: () => Promise<void> }[] = [];
    plugin.addCommand = vi.fn<Plugin["addCommand"]>(command => {
      commands.push(command as { id: string; callback: () => Promise<void> });
      return command;
    });
    plugin.app = { vault: { getName: () => "a personal vault" } } as unknown as App;
    plugin.onload();
    expect(commands.map(command => command.id)).toEqual(["extract", "pdf-page-3", "note-passage"]);
    // These callbacks refuse the personal vault before accessing its files or loader.
    for (const command of commands) await expect(command.callback()).resolves.toBeUndefined();
    plugin.onunload();
  });
});
