# Gate B — PDF extraction and navigation (M4-T01)

**Outcome: pending real Obsidian observations.** The harness is ready; mock results
do not establish PDF.js compatibility or visible viewer behavior. M4-T01 remains
`IN_PROGRESS`. This probe does not implement PDF ingestion, alter production
defaults, or start Gate A.

## Build and prepare a disposable vault

Requirements: repository dependencies installed, Python 3, and `qpdf` on PATH.
The fixture generator refuses an existing destination and creates only synthetic
files. The development machine has qpdf installed. No extra Python packages or
network calls are needed. Do not use an existing vault for this probe.

From the repository root, run:

```sh
task_probe_root=$(mktemp -d /tmp/synapse-gate-b.XXXXXX)
task_probe_vault="$task_probe_root/Synapse Gate B"
python3 spikes/pdfjs-probe/fixtures.py "$task_probe_vault"
mkdir -p "$task_probe_vault/.obsidian/plugins/synapse-gate-b"
./node_modules/.bin/esbuild spikes/pdfjs-probe/main.ts --bundle --platform=node --format=cjs --target=es2020 --external:obsidian --external:electron --outfile="$task_probe_vault/.obsidian/plugins/synapse-gate-b/main.js"
cp spikes/pdfjs-probe/manifest.json "$task_probe_vault/.obsidian/plugins/synapse-gate-b/manifest.json"
printf '%s\n' "$task_probe_vault"
```

Open the printed directory as a vault in Obsidian. Enable community plugins and
**Synapse Gate B** in this disposable vault. It needs no Synapse installation or
API key. The command callbacks refuse vaults whose name is not `Synapse Gate B`.
The operator must also ensure this is the newly generated vault, since the name
guard alone cannot prove that its files are synthetic.

The three files in `spikes/pdfjs-probe/` are the independent composition root,
manifest, and fixture generator. Obsidian imports remain in the adapter. The
probe is not included in the production entrypoint or release artifacts.

## Run and return observations

1. Close all PDF tabs. Run **Synapse Gate B: Measure PDF extraction (no viewer)**
   before opening any PDF. Confirm no PDF viewer appeared during extraction.
   Copy the JSON from the report modal. Run once more to capture warm timings.
2. Expected synthetic results: `text` has three pages with nonzero character
   counts; `blank` has three pages with zero counts; `corrupt` returns
   `PDF_CORRUPT`; `encrypted` returns `PDF_ENCRYPTED` without a password dialog.
   No row should have `cleanupFailed: true`. Report deviations without copying
   console errors or document text.
3. Run **Open synthetic PDF at page 3**. Confirm the visible viewer page is 3 and
   the page label says “Gate B synthetic page 3”. Move to page 1 and run the
   command again; it must return to page 3. Record both results. A resolved
   `openLinkText` promise alone is not proof of successful navigation.
4. Run **Select synthetic Markdown passage**. Confirm source mode opens, the
   exact two-line passage is selected, and it is visible after scrolling.
   The fixture has a prefix before the passage, exercising quote resolution
   against the editor buffer rather than blindly selecting offset zero.
5. Disable and enable the probe, then repeat extraction. Confirm commands work
   after reload. Unload during extraction if practical; report late modals or
   errors. Unload aborts the harness and destroys active PDF loading tasks.
6. Return the two JSON reports plus the observations below. Disable the probe and
   close the disposable vault after the run. Remove its temporary directory
   only after recording results; leave original vaults untouched.

| Observation | Result |
|---|---|
| Date, OS, CPU, RAM | Pending |
| Obsidian runtime and PDF.js versions | Pending (included in JSON) |
| Cold extraction without a PDF viewer | Pending |
| Warm extraction without a PDF viewer | Pending |
| Text/blank/corrupt/encrypted expected outcomes | Pending |
| Fresh PDF opens at page 3 | Pending |
| Already-open PDF returns from page 1 to page 3 | Pending |
| Exact Markdown passage selected and scrolled into view | Pending |
| Reload/unload behavior | Pending |

The JSON includes loader time, byte sizes, document-open time, page count,
per-page extraction time and non-whitespace character count, cleanup failures,
and the maximum heartbeat delay beyond its 20 ms interval. It contains fixed
fixture IDs, numeric measurements, sanitized versions, and fixed error codes;
no paths, extracted text, passwords, prompts, or keys. PDF.js verbosity is zero.
Each awaited I/O operation has a 30-second deadline. The heartbeat covers loading,
reads, extraction, and cleanup, so its maximum is an end-to-end preliminary UI
delay measurement, not an extraction-only metric. A hung JavaScript main thread
cannot be interrupted by a timer.

At most ten pages per fixture are extracted; `truncated` explicitly indicates
larger documents. These caps and timers are harness parameters, not production
tuning. They do not establish AC-M4.6's 500-PDF ingestion requirement.

## Decision record

| Gate | Decision / evidence |
|---|---|
| R7 / OQ-4: bundled PDF.js | Pending. Installed Obsidian typings expose `loadPdfJs()`; runtime extraction is unverified. Prefer bundled PDF.js only after the successful probe. |
| Fallback bundle | No `pdfjs-dist` dependency added. If the bundled loader/extractor fails, record the exact fixed error category and runtime version, then define the adapter/worker and measured bundle-size follow-up before M4-T02. |
| R10 / F-23: PDF page fragments | Pending. The probe calls the existing navigation adapter's public `openLinkText` path. Visible page movement must be observed. |
| R10 / F-23: Markdown scroll | Pending. Existing adapter uses public editor selection and scrolling; the probe supplies exact-quote resolution. |
| `EMPTY_PAGE_CHARS`, cache cap | Unchanged and provisional. Synthetic fixtures alone do not justify production thresholds or cache limits. |

Before marking this task `DONE`, replace pending entries with dated observations,
record a supported extraction/navigation strategy, and attach the measured JSON
reports (synthetic summaries only). If a gate fails, retain the incomplete status
and report the specific blocker; do not infer success from mock tests.

## Automated validation

The colocated harness tests cover accounting, blank pages, extraction caps,
sanitized error/version output, loader failure, timeout, cancellation, and page /
loading-task cleanup. Navigation tests already cover adapter dispatch and
passage selection on injected surfaces. Required repository checks and builds
must pass before delivery. Automated outcomes are recorded in PROGRESS.md;
they are separate from the pending manual gate observations.

API references: [PDF.js loading task and destruction](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html),
[PDF.js document proxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html).
