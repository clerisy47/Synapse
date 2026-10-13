/** Gate B diagnostic only. No filesystem, network, vault writes, or note input. */
const PAGE_COUNT = 100;
const SYNTHETIC_TEXT = 'Synapse synthetic PDF extraction fixture';

// ASCII-only PDF with a correct byte-offset xref; fixtures exist only in memory.
function makePdf(texts) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${texts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [i, text] of texts.entries()) {
    const escaped = text.replace(/[\\()]/g, '\\$&');
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function fixtures() {
  return [
    { id: 'text', texts: [SYNTHETIC_TEXT, SYNTHETIC_TEXT] },
    { id: 'sparse', texts: ['Sparse slide text'] },
    { id: 'mixed', texts: [SYNTHETIC_TEXT, ''] },
    { id: 'empty', texts: ['', ''] },
    { id: 'hundred-pages', texts: Array(PAGE_COUNT).fill(SYNTHETIC_TEXT) },
    { id: 'corrupt', bytes: new TextEncoder().encode('not a PDF') },
  ].map(fixture => ({ ...fixture, bytes: fixture.bytes ?? makePdf(fixture.texts) }));
}

async function runProbe(loadPdfJs, now = () => performance.now()) {
  const started = now();
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
    if (typeof pdfjs?.getDocument !== 'function') throw new Error();
  } catch {
    return { loader: 'PDFJS_UNAVAILABLE', loaderMs: now() - started, results: [] };
  }
  const report = {
    loader: 'ok', version: typeof pdfjs.version === 'string' ? pdfjs.version : 'unknown',
    loaderMs: now() - started, results: [],
  };
  for (const fixture of fixtures()) {
    const begin = now();
    let task;
    let result;
    try {
      // Match the future adapter: binary data, real default worker, no viewer.
      task = pdfjs.getDocument({ data: fixture.bytes });
      const doc = await task.promise;
      const pageMs = [];
      const chars = [];
      let matches = doc.numPages === fixture.texts?.length;
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const pageStart = now();
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str).join(' ');
          chars.push(text.replace(/\s/g, '').length);
          matches &&= text === fixture.texts?.[pageNumber - 1];
          pageMs.push(now() - pageStart);
        } finally {
          page.cleanup();
        }
      }
      result = { id: fixture.id, outcome: matches ? 'ok' : 'mismatch', pages: doc.numPages, chars, pageMs };
    } catch (error) {
      // Never return exception messages: they may include paths or content.
      const code = error?.name === 'PasswordException' ? 'PDF_ENCRYPTED'
        : error?.name === 'InvalidPDFException' ? 'PDF_CORRUPT' : 'PDFJS_UNAVAILABLE';
      result = { id: fixture.id, outcome: code };
    } finally {
      try { await task?.destroy(); }
      catch { result = { ...result, cleanup: 'failed' }; }
    }
    report.results.push({ ...result, totalMs: now() - begin });
  }
  return report;
}

module.exports = { makePdf, fixtures, runProbe };
