import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { fixtures, runProbe } = require('../../spikes/pdfjs-probe/probe.cjs');

describe('Gate B probe contract (not a real PDF.js renderer test)', () => {
  it('produces correct xref offsets and page counts for in-memory fixtures', () => {
    for (const fixture of fixtures().filter((entry: { texts?: string[] }) => entry.texts)) {
      const pdf = new TextDecoder().decode(fixture.bytes);
      const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
      expect(pdf.slice(xref)).toMatch(/^xref\n/);
      const entries = pdf.slice(xref).split('\n').slice(3);
      for (let i = 1; i < Number(pdf.slice(xref).split('\n')[1].split(' ')[1]); i++) {
        expect(pdf.slice(Number(entries[i - 1].slice(0, 10)))).toMatch(new RegExp(`^${i} 0 obj\\n`));
      }
      expect(pdf).toContain(`/Count ${fixture.texts.length}`);
    }
  });

  it('returns a safe unavailable result when the public loader fails', async () => {
    const report = await runProbe(async () => { throw new Error('secret loader details'); });
    expect(report).toMatchObject({ loader: 'PDFJS_UNAVAILABLE', results: [] });
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('extracts every page, measures timing and destroys every loading task', async () => {
    const generated = fixtures();
    let next = 0;
    let destroyed = 0;
    let cleaned = 0;
    const report = await runProbe(async () => ({
      version: 'fake-contract-only',
      getDocument: () => {
        const fixture = generated[next++];
        return {
          promise: fixture.texts ? Promise.resolve({
            numPages: fixture.texts.length,
            getPage: async (page: number) => ({
              getTextContent: async () => ({ items: [{ str: fixture.texts[page - 1] }, { type: 'marked-content' }] }),
              cleanup: () => { cleaned++; },
            }),
          }) : Promise.reject(Object.assign(new Error('private path'), { name: 'InvalidPDFException' })),
          destroy: async () => { destroyed++; },
        };
      },
    }));
    expect(report.results.map((entry: { outcome: string }) => entry.outcome)).toEqual([
      'ok', 'ok', 'ok', 'ok', 'ok', 'PDF_CORRUPT',
    ]);
    expect(report.results[2].chars[1]).toBe(0);
    expect(report.results[4].pageMs).toHaveLength(100);
    expect(destroyed).toBe(6);
    expect(cleaned).toBe(107);
    expect(JSON.stringify(report)).not.toContain('private path');
  });
});
