# Gate B — PDF extraction and page navigation

Task: M4-T01. Recorded 2026-10-13. **Renderer validation pending; this gate is not passed.**

## Evidence available

- Installed desktop app: Obsidian 1.14.4 (reported by the app launcher).
- Installed public API declarations: `obsidian` 1.13.1 exports `loadPdfJs()` and documents its result as the PDF.js library. This establishes API availability in declarations, not runtime compatibility or a PDF.js version.
- The running app has no available remote debugging endpoint. Running the app executable with `help` reports that its CLI is disabled and the installer is out of date. Application settings and the existing vault were not changed.
- The probe contract tests pass with an explicitly fake loader; these are not extraction performance measurements.
- Poppler `pdfinfo` and `pdftotext -raw` independently validate the generated text, sparse, mixed, empty and 100-page fixtures: page counts and every page's synthetic text match. Temporary fixtures are removed after validation. Empty fixtures exercise absence of text; they do not simulate raster scans.

| Required observation | Outcome |
| --- | --- |
| Public loader in the real renderer; actual PDF.js version | Pending |
| Extract pages without opening a PDF viewer | Pending |
| Cold loader/open time and per-page extraction time | Pending |
| Sparse and mixed page preservation | Fixtures validated; real PDF.js extraction pending |
| Corrupt/password-protected error names and cleanup | Mock corrupt mapping tested; real errors and encrypted fixture pending |
| `openLinkText('file.pdf#page=2')` visibly reaches page 2 | Adapter dispatch covered by existing tests; viewer validation pending |
| Many-PDF responsiveness and AC-M4.6 startup budget | Pending; one synthetic document cannot establish this |

## Reproducible renderer probe

`spikes/pdfjs-probe/probe.cjs` is a diagnostic CommonJS module, excluded from the production bundle. It generates PDFs in memory; it does not read a vault or make network requests. Its results contain fixture IDs, version, character counts, error codes and timings, with no page text or exception messages. It uses the real default PDF.js worker settings, calls `getPage()` / `getTextContent()`, cleans pages and destroys loading tasks.

In an Obsidian desktop developer console, substitute the absolute repository location below, then run:

```js
const probe = require('/ABSOLUTE/REPO/spikes/pdfjs-probe/probe.cjs');
const report = await probe.runProbe(() => require('obsidian').loadPdfJs());
console.log(JSON.stringify(report, null, 2));
```

Run twice to distinguish cold loading from warm extraction. All five valid fixtures must report `ok`, and `corrupt` must report `PDF_CORRUPT`; any `cleanup: 'failed'` needs investigation. Record the app/PDF.js versions, machine, loader time, total document time and median/max page times. The 100-page fixture supplies a repeatable baseline, not a representative real-vault latency claim. An unavailable result keeps PDF ingestion disabled while notes remain usable.

For navigation, use a known synthetic PDF with at least two pages in an isolated test vault. Do not write it into user notes with a plugin or the console. Invoke the existing `NavigationPort.openAt` PDF branch or the equivalent public `workspace.openLinkText` call with `#page=2`, then visually verify page 2 from both a closed and an already-open viewer. A resolved promise alone does not prove navigation. Record that result here. Also test an independently generated password-protected PDF and record only error codes, never passwords or text.

## Adapter and fallback decision

The implementation candidate for M4-T02 is the public Obsidian loader behind `PdfJsPort`, using binary data, preserving 1-based page access, and destroying loading tasks on both success and failure. PDF.js documents the loading-task promise and page API in its [official examples](https://mozilla.github.io/pdf.js/examples/); text extraction details must be confirmed against the version returned by Obsidian.

Do not add `pdfjs-dist`, worker assets, fonts or cmaps yet. Bundling is conditional on a failed real-renderer loader/worker probe and must include measured bundle cost and offline worker/asset checks. Until runtime evidence exists, neither a successful bundled-loader outcome nor a fallback bundle size is claimed. Keep `EMPTY_PAGE_CHARS`, cache caps and performance budgets provisional; this session provides no basis to change constants. M4-T02 stays dependent on completion of this gate.
