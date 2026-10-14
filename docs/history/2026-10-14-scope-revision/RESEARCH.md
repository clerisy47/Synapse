# research.md: Synapse Phase 0

Date: 2026-10-02. Input: `SPEC.md` (draft v1). Scope: reduce the biggest unknowns before the design is committed. No implementation was started.

**Evidence tags** used throughout:
**[V]** verified by running something here · **[S]** read from a primary source (source code, typings, lint rules, official pages) ·
**[B]** community or secondary source · **[D]** derived from stated assumptions (a model, not a measurement) · **[U]** unverified, needs real hardware or Obsidian.

**What I could and could not do.** There was no repo (only the spec), so everything came from primary sources and experiments.
The sandbox is 1 vCPU / 4 GB, Linux, with no GPU, no macOS, no Obsidian, and no route to Ollama's model registry.
So I **ran** the real Ollama server (v0.35.0) and Obsidian's real typings and review lint, but I **could not run any model or Obsidian itself**.
Anything that needs a model or the Obsidian renderer is marked [U], and I left a bake-off harness and a probe plugin in `spikes/` to close those on the real machine.

---

## 1. Summary: what changes in the spec

Ordered by impact on the design.

| # | Finding | Tag | Spec impact |
|---|---|---|---|
| 1 | **The latency budgets don't fit the loop as specified.** On an 8 GB Mac, decode time dominates. A free-running 3-hop loop only meets 45 s in 1 of 9 speed scenarios I modelled, and a 6-hop loop in none. AC-M6.8 (60 s) fits 2–6 `compare` passes if quotes are verbatim; the spec's own definition needs 6–15. | D | AC-M2.3, M3.2, M5.1, M6.8. Redesign the loop shape (§2.6). |
| 2 | **Both candidate models in the brief fail the spec's own constraints.** Gemma E4B is 6.1–6.6 GB on Ollama today, above the ~5.3 GiB GPU working set of an 8 GB Mac. Qwen3-4B-**Thinking**-2507 is thinking-only, so thinking cannot be disabled. | S, D | OQ-5, Constraints/Model. The viable bake-off entries are Qwen3-4B-**Instruct**-2507 (2.5 GB) and Gemma 4 E2B QAT (4.3 GB). |
| 3 | **Ollama structured output has a recent history of silent failure** exactly where the spec relies on it (`think:false` + `format`, and MLX builds). Responses are HTTP 200 with prose. | B | AC-M1.1, M1.4. The health check must use the production request shape. |
| 4 | **CORS is not a problem; the review rules are.** Stock Ollama accepts `app://obsidian.md` with zero config. But `fetch` triggers a lint warning that cannot be suppressed, and `requestUrl` can neither stream nor cancel, which breaks AC-M1.6 outright. | V, S | OQ-1. Use a guarded Node `http` transport behind an interface. |
| 5 | **OQ-2 is settled.** `getBacklinksForFile` is not in the public typings. Inverting `resolvedLinks` costs 53 ms for ~99k edges. | S, V | Invert it ourselves. |
| 6 | **The mtime rule fails silently on slow syncs.** The 1-hour definition missed a 3-hour sync (33.8% < 50%). A sliding 48-hour window catches it without false positives. | V (simulated) | OQ-3, AC-M7.3. |
| 7 | **The scanned-PDF rule is wrong on 3 of 6 PDF shapes.** Sparse slide decks with a real text layer are excluded; mixed PDFs lose pages silently. | V | AC-M4.2, M4.3. Classify per page. |
| 8 | **New risks the spec doesn't list:** a model-supplied regex froze the thread for 58 s; `search_text` stalls the main thread 120–575 ms per call; the cache costs ~200–450 MB; the plugin ID `synapse` is already taken; changing `num_ctx` between requests reloads the model; Ollama has no pause, only a queue. | V, S | §3. |

**Recommendation in one paragraph.** Keep the spec's overall shape, but (a) talk to Ollama through a transport interface with Node `http` as the primary,
(b) replace the free-running hop loop with a short, mostly deterministic pipeline of about three model calls with a wall-clock budget,
(c) make `compare` return excerpt IDs instead of verbatim quotes, (d) pin exact GGUF model tags and run the health check with the production request shape,
(e) classify PDFs per page, and (f) rename the plugin. Do **not** commit the Q&A and contradiction latency criteria, or the recommended model, until the
on-device bake-off in §5 has run. That run is the single biggest remaining unknown.

---

## 2. Findings by open question

### 2.1 OQ-1: Ollama CORS and transport

**Findings**

- **CORS is not a blocker.** Real Ollama 0.35.0 with `OLLAMA_ORIGINS` unset answered a preflight from `app://obsidian.md` with `204`,
  `Access-Control-Allow-Origin: app://obsidian.md`, `POST` allowed and `Content-Type` allowed. [V] (`spikes/cors/RESULT.txt`)
  The default allowlist includes `app://*` with wildcard matching on. [S] A non-allowlisted origin gets `403`. [V] A missing model returns a distinguishable
  `404 {"error":"model '…' not found"}`, which is what AC-M1.1's separate "model present" check needs. [V]
- It has been that way for a long time: `app://` is in the default origins in every tag I checked from v0.3.0 on. [S] It is moot anyway,
  because the features the spec needs are newer: schema-constrained `format` arrived in v0.5.0 and the `think` switch in **v0.9.0**. [S]
  So the practical minimum Ollama version is 0.9.0, not a CORS question.
- **`requestUrl` cannot stream or cancel.** `RequestUrlParam` has no `signal`, and the response exposes only `arrayBuffer` / `json` / `text`. [S] (obsidian 1.13.1 typings)
  If a user cancels, the model keeps generating. And since Ollama runs one request at a time by default (`OLLAMA_NUM_PARALLEL=1`, [S]),
  the next request queues behind the abandoned one. AC-M1.6 ("cancellation stops generation within 2 s") is not achievable with `requestUrl`.
- **`fetch` is discouraged by the review tooling.** Obsidian's lint (`eslint-plugin-obsidianmd` 0.4.2) reports a warning on `fetch`, and **disabling that rule inline is itself an error**
  ("Disabling 'no-restricted-globals' is not allowed"). [V] The official submission checklist says: "Don't use `fetch` or `axios.get`, use Obsidian's `requestUrl` instead." [S]
  AC-M9.6 requires passing that checklist.
- **Node `http` is lint-clean if done the recommended way.** A dynamic `await import('http')` guarded by `Platform.isDesktop` produced no diagnostics; an unguarded `require('http')` produced warnings and errors. [V]
  The plugin is `isDesktopOnly`, so this is available. Against a mock streaming server, first chunk arrived when emitted (1559 ms ≈ 1500 ms prefill + one token) and an abort was
  noticed by the server in 2 ms and stopped generation in 6 ms. [V, mock] Real Ollama's reaction depends on its runner: the generation context derives from the HTTP request context, so a disconnect should cancel it. [S] End-to-end is [U] (bake-off T5).
- **Precedent.** `pfrankov/obsidian-ai-providers` (directory-listed, last commit 2026-09-19) ships three Ollama transports chosen at runtime: Electron `remote.net.request`, a `requestUrl` wrapper, and native `fetch` behind a setting,
  with a selector that falls back when a provider is CORS-blocked. [S] Two other listed Ollama plugins use plain `requestUrl` (non-streaming). [S] So reviewers have accepted at least some `fetch`/Electron usage; I cannot tell how they would treat a new submission under today's lint. [U]

**Options**

| Option | Streams | Cancels | Review risk | Fragility | Notes |
|---|---|---|---|---|---|
| A. `requestUrl` only | No | No | Lowest | Low | Breaks AC-M1.6; progress is state-only; "pause" impossible. |
| B. `fetch` | Yes | Yes | Warning that can't be suppressed | Low | Needs CORS to hold; works today by default. |
| C. Node `http` (guarded dynamic import) | Yes | Yes | Lint-clean; reviewer stance **[U]** | Low | No CORS involved at all. Desktop-only, which the spec already requires. |
| D. Electron `remote.net` (precedent) | Yes | Yes | Needs `@ts-ignore`; `remote` is deprecated in Electron | High | Works in the precedent today; I would not depend on it. |
| E. **C as primary + `requestUrl` for health checks and a degraded fallback** | Yes | Yes (primary) | As C | Low | Fallback mode has no cancel and no progress, and says so in the UI. |

**Recommendation: E**, behind a small `Transport` interface (`get`, `postStream(signal)`), so a reviewer objection to Node `http` is a one-file change.
Ask the Obsidian review team early whether guarded Node `http` to loopback is acceptable. Do not put `OLLAMA_ORIGINS` instructions in the README (keep it only as a troubleshooting note for proxy setups).

### 2.2 OQ-2: Backlinks API

- No occurrence of "backlink" anywhere in the 1.13.1 typings, changelog, or README. `metadataCache.resolvedLinks` and `unresolvedLinks` are public. [S/V]
- Inverting `resolvedLinks` for a synthetic 10k-note vault (99,288 edges): **53 ms** full, **0.008 ms** incremental per changed note. [V, synthetic]
- The checklist bans `as any` [S], so calling the private `getBacklinksForFile` would be a review problem on top of being unsupported.

**Recommendation:** invert `resolvedLinks` once at startup (after the metadata cache signals it is resolved; guard against an empty cache) and update incrementally on `changed`/`deleted`.
Apply the exclusion filter (AC-M8.4) **while building the inverted graph**. That makes OQ-11's proposed default ("a link to an excluded note is treated as unresolved") fall out for free and keeps AC-M2.7 true by construction.

### 2.3 OQ-3: "near-identical mtime"

Tested the spec's rule (>50% of notes in the same fixed 1-hour bucket) on real clones and on simulated sync scenarios (10,000 notes).

| Scenario | Spec rule (1 h bucket) | Sliding 48 h window |
|---|---|---|
| Real clones: obsidian-help (6,396 files), foam (124), developer-roadmap (11,045) | 100% → triggers | 100% → triggers |
| Healthy vault, preserved mtimes (sim) | 0.9% | 5.1% |
| Heavy editing week, 30% of notes touched (sim) | 0.9% | 11.6% |
| Sync stamps mtime, 10 min / 1 h (sim) | 100% → triggers | 100% → triggers |
| **Sync stamps mtime over 3 h (sim)** | **33.8% → misses** | 100% → triggers |
| **Over 12 h** | **8.9% → misses** | 100% → triggers |
| 3 h, only 60% of notes affected | 20.4% → misses | 60.4% → triggers |
| Vault-wide bulk edit over 20 min | 100% | 100% |

The fixed 1-hour bucket works for instant clones but fails whenever a sync of a large vault takes longer than about two hours. [V]
Caveat: the sync scenarios are simulated. I don't know how Obsidian Sync, iCloud, Dropbox, or Syncthing stamp mtimes on a fresh device. [U]
`obsidian-probe` prints the real distribution for any vault it runs in.

**Recommendation:** "more than 50% of notes fall inside any 48-hour window" (sliding window over sorted mtimes, O(n log n)). Make the window a constant, not a setting.
A bulk edit that trips it is a correct trigger, since mtime is meaningless in that vault.

### 2.4 OQ-4: pdf.js access

**Findings**

- `loadPdfJs(): Promise<any>` is public ("Load PDF.js and return pdfjsLib"). [S] One listed plugin's release notes describe pre-loading it dynamically so background PDF work succeeds without the user having opened a PDF. [B]
  Counterpoint: the two best-known extraction efforts (Text Extractor, the worker-pool library behind Omnisearch) describe PDF extraction as resource-heavy and sometimes failing. [B]
- Which pdf.js version Obsidian ships, and whether `loadPdfJs` gives a real Web Worker outside the viewer (which decides AC-M4.6's 500 ms), are not documented. [U] The probe plugin reports `pdfjsLib.version`, per-page time and longest page.
- **Extraction is cheap.** 3.8 ms/page on synthetic text PDFs (slowest page 16.7 ms), about 1.9 min of CPU for 30,000 pages. [V, synthetic: real papers with embedded fonts will be slower] pdf.js throws distinct `PasswordException` and `InvalidPDFException`, which map straight onto AC-M4.5. [V]
- **The detection rule is unreliable.** Results on six generated PDFs (`spikes/pdf`):

| PDF shape | Truth | "first 5 pages" avg → verdict | "evenly spaced 5" avg → verdict | Outcome |
|---|---|---|---|---|
| 60-page text | text | 2254 → text | 2254 → text | ok |
| 60-page pure scan | scanned | 0 → scanned | 0 → scanned | ok |
| Scan with OCR text layer | text | 2171 → text | 2159 → text | ok |
| Typed intro (5 p) + scanned body (55 p) | mixed | 2255 → text | 456 → text | **55 pages silently unsearchable** |
| Scanned cover (5 p) + typed body (55 p) | mixed | 0 → **scanned** | 1795 → text | **55 text pages wrongly excluded** (first-5 only) |
| 40 slides, real text layer, ~23 chars/page | text | 23 → **scanned** | 23 → **scanned** | **valid PDF wrongly excluded** |

  A single dense text page among five sampled pages is enough to pass the average (456 ≥ 50), and a sparse but real text layer fails it.

**Options for the rule**

| Option | Behavior | Trade-off |
|---|---|---|
| 1. Spec: average over ≤5 sampled pages, all-or-nothing | Fails the three rows above | Cheapest; silent recall loss |
| 2. **Per-page**: extract every page (it's needed anyway), mark a page unsearchable if it has ≈0 characters, index the rest; settings lists "N of M pages have no text layer" | Handles mixed and sparse-slide PDFs | Needs per-page storage (the cache is already per page for page-number hits); threshold needs tuning on real scans **[U]** |
| 3. Bundle OCR | Out of scope | Spec non-goal |

**Recommendation: option 2.** Fallback if `loadPdfJs` proves unusable: bundle `pdfjs-dist` 6.3.289, about **1.7–1.8 MB** minified (main ≈ 0.45–0.5 MB + worker ≈ 1.2–1.3 MB), plus 0.8 MB standard fonts and 1.7 MB cmaps if non-Latin text matters. [V, measured]
Extract in small batches with a yield between pages, and key the cache on path + mtime + size.

### 2.5 OQ-5 and OQ-6: model choice and structured output

**Model landscape (today).** The brief's names are stale. Gemma 3n has been superseded by Gemma 4. Ollama tag sizes, verified from Ollama's own pages [S]:

| Tag | Size | Fits an 8 GB Mac GPU? (cap ≈ 5.33 GiB [D]) | Notes |
|---|---|---|---|
| `qwen3:4b-instruct-2507-q4_K_M` | 2.5 GB | **Yes**: ~3.3 GiB total at 4K ctx | Non-thinking. 36 layers × 8 KV heads × 128 dim → 0.56 GiB KV at 4K, 1.12 GiB at 8K (f16) [D from verified hyperparameters] |
| `qwen3:4b-instruct-2507-q8_0` | 4.3 GB | Yes, ~5.0 GiB: tight | |
| `gemma4:e2b-it-qat` / `-q4_K_M` | 4.3 / 4.6 GB | Borderline, 4.4–4.7 GiB before KV **[U]** | KV size not computed (hyperparameters not verified) |
| `gemma4:e4b-it-qat` / `-q4_K_M` | 6.1 / 6.6 GB | **No** (weights alone exceed the cap) | Fine for 16 GB machines |
| `qwen3:4b-thinking-2507-*` | same 4B class (size not separately checked) | Yes | **Thinking-only** per Qwen's published description (seen in search results, [B]): cannot satisfy "thinking must be disabled" |

- The GPU cap is derived: macOS reserves one third of unified memory for machines up to 32 GB, so 8 GiB × ⅔ ≈ 5.33 GiB. [D] It is a soft limit, and llama.cpp spills layers to CPU beyond it. [B]
  Ollama's server log prints the exact `recommendedMaxWorkingSetSize` on the real machine. [U]
- **Sizes float.** `gemma4:e4b` was reported at 9.6 GB by one blog and shows 6.6 GB on Ollama's page today (updated within a day). The `latest` tag spans GGUF and MLX artifacts (6.6–9.5 GB). Never store `latest` or a bare family tag.
- **The spec's worry ("8 GB may force ≤3B models") is not supported by memory math.** A 4B Q4 model fits comfortably. The binding constraint is **latency**, not memory (§2.6).
- KV-cache type (`OLLAMA_KV_CACHE_TYPE`) and flash attention are **server environment variables**, not request options. [S] The plugin cannot set them, so assume f16 KV when budgeting.

**Structured output (OQ-6).**

- Mechanics: with thinking enabled, `format` "leaves free" the thinking span and constrains only what follows it. [S] With `think:false` the response starts in content, so the grammar applies from token 1.
- **Thinking is ON by default** for any model with the thinking capability unless the request sends `think:false`; `think:true` on a non-thinking model returns 400. [S] Always send `think` explicitly.
- Minimum versions: schema `format` ≥ 0.5.0, `think` ≥ 0.9.0. [S]
- **Silent-failure history [B]:** `think:false` + `format` ignored for Gemma 4 (#15260, fixed in 0.21.1) and Qwen 3.5 (#14645); Gemma 4 `e4b` returning fenced JSON when thinking is not disabled (#15416);
  `format` ignored on **MLX** builds of Gemma 4 and Qwen 3.5 at every `think` setting, while GGUF builds honor it (#17183); a stray leading `.` on MLX structured output with thinking on (#18441, Ollama 0.34.0).
  All return HTTP 200. Apple Silicon is the spec's floor hardware, and the default pull for some tags may be MLX. Whether an 8 GB M1 gets MLX builds is [U] (one blog says MLX isn't used there).
- No model I could run, so JSON-validity for Qwen3-4B-Instruct-2507 and Gemma 4 E2B with `think:false` + `format` is **[U]**. Bake-off T2 measures it.

**Recommendation**

1. One production request shape for **every** call, including the health check: `{think:false, format:<schema>, options:{num_ctx:<fixed>, temperature:0}, keep_alive}`. A health check with a different shape can pass while production fails (the #15260 pattern).
2. Treat "response is not JSON although `format` was sent" as a distinct error ("this model/Ollama build ignores `format`"), disable AI features, and show a remediation message. Keep AC-M1.4's validate-then-retry-once.
3. Store pinned, explicit GGUF tags and digests in the recommended list; record Ollama version with eval results; refuse MLX tags until `format` is verified on that build.
4. Keep `num_ctx` **identical for every request** (see §3, R4).
5. Bake-off entries: `qwen3:4b-instruct-2507-q4_K_M` and `gemma4:e2b-it-qat`. I did not verify current Ollama sizes for other plausible small models (Llama 3.2 3B, Phi-4-mini, Granite 4); add them if the first two fail the gates.
   I cannot name a "recommended" model yet. Pre-register the pass/fail gates in §5 so the choice isn't made after seeing results.

### 2.6 Latency: the budgets in AC-M3.2, M6.8, M7.10 (not an open question in the spec, but the biggest risk)

A transparent model, not a measurement (`spikes/latency/budget.py`). Inputs, stated so they can be replaced by bake-off output:
decode 12–25 tok/s (community figures for ~4B Q4 on an M1 Air 8 GB are ~15–20 [B]); prefill 80–250 tok/s (**no trustworthy M1 8 GB figure found [U]**);
3 s cold load; 700-token system+tool prompt; ~350 tokens per search result; ~1,100 per note read; 80 output tokens for the plan, 70 per hop decision, 280 for a cited answer.

| Pipeline | Prefix reused between calls | Result across the 9 speed scenarios |
|---|---|---|
| Free-running loop, 3 hops (plan → 3 decisions → answer) | yes | 37–87 s; under 45 s in **1 of 9** (fastest scenario) |
| Same, 6 hops (the spec's cap) | yes | 59–145 s; **0 of 9** |
| Same, 3 hops | no | 67–179 s; 0 of 9 |
| **Lean: 3 model calls** (plan → deterministic searches → pick → read → answer) | yes | 28–66 s; under 45 s in **5 of 9** (all need ≥150 tok/s prefill; at 150 also ≥18 tok/s decode) |
| Lean, no prefix reuse | no | under 45 s in 2 of 9 |

Decode dominates: a 3-hop loop emits ~570 output tokens, which is ~32 s at 18 tok/s before any prefill.

**`compare` and AC-M6.8 (60 s).** Each pass costs 7.8–17.0 s with verbatim `quotes` (≈150 output tokens) versus 3.4–7.8 s if the model returns excerpt IDs (≈40 tokens).
After one claim-extraction call, a 60 s budget holds **2–6** verbatim passes or **5–14** ID passes. The spec's own definition (2–5 claims × ~3 candidates, plus a swapped second pass per "disagree") needs 6–15.
AC-M7.10 (5 min, 15 passes) is fine: about 170 s at 150 / 18 tok/s.

**First visible progress in 3 s (AC-M3.2).** A cold load (~3 s assumed) plus prefilling ~760 tokens (~5 s at 150 tok/s) puts the first model token past 8 s. "Progress" must therefore be a UI state emitted by the state machine ("Searching…"), not model output.

**Recommendation**

- Replace the free-running plan/search/read/evaluate loop with a **short pipeline of ≈3 model calls**: plan (queries + filters) → deterministic searches → pick → read → answer.
  Keep the hop cap as a safety net, and add a **wall-clock budget** that forces the answer stage when time is nearly spent.
- `compare` returns **excerpt IDs**; the plugin fills in the verbatim text. This also makes substring verification true by construction (see R8).
- Keep the prompt prefix (system prompt and tool/schema text) byte-identical across calls so Ollama can reuse its KV cache. Verify via `prompt_eval_count` on the second call (bake-off T4).
- In AC-M6.8, cap claims × candidates (e.g., ≤ 6 first passes) and run the swapped pass only on "disagree". Or relax the budget on the floor tier (e.g., 120 s) and keep 60 s for faster hardware.
- Do not commit AC-M3.2 and AC-M6.8 numbers until the bake-off supplies real prefill and decode rates.

### 2.7 OQ-7 to OQ-15: triage

| OQ | Disposition | Notes |
|---|---|---|
| 7 Contradiction recall | **Deferred**: needs the model and fixture vault | Not answerable by research. Keep the plan: measure first, then set the floor. |
| 8 Debounce / battery | Open, low | Not investigated. Ollama unloads idle models after 5 min by default [S]; consider `keep_alive` policy. Battery/memory-pressure signals from the renderer are [U]. |
| 9 Claim scoping | Product decision | Suggest: flag only when the other note was not edited this session, as in the spec. No research needed. |
| 10 "Related" bar | **Deferred**: tune on the fixture vault | Needs the model. |
| 11 Excluded-note links | **Answered by design** | Filter at graph-build time (§2.2). The spec's default falls out. |
| 12 Quote length | Low | 300 chars fine as a *display* limit. If `compare` returns IDs, the model's output length no longer depends on it. |
| 13 Multi-window concurrency | **Partly answered** | Whatever the plugin does, Ollama's single runner (`NumParallel=1`) serializes requests from every client. [S] I did not verify how Obsidian instantiates plugins across pop-out windows or a second app window on the same vault. [U] Suggest: one in-process queue in v1, documented. |
| 14 Accessibility/theming | Not investigated | Standard CSS variables + `registerEditorExtension`; verify in the fixture UI. |
| 15 i18n | Not investigated | Spec default (English-only, strings centralized) is fine. |

---

## 3. Risks not listed in the spec

| ID | Risk | Evidence | Recommendation |
|---|---|---|---|
| R1 | **Latency budgets** (§2.6) | D | Lean pipeline, ID-based quotes, wall-clock budget, bake-off before committing numbers. |
| R2 | **A model-written regex can freeze Obsidian.** `/^(a+)+$/` on 31 characters blocked the thread for **58 s**. Even honest regexes make `search_text` a main-thread stall. | V | No model-supplied regex: terms/phrases only. Escape input. |
| R3 | **`search_text` blocks the main thread.** Scanning 118 MB (10k notes + 30k PDF pages) took 123–574 ms p50 (3–5 common terms: 353–574 ms) on this sandbox. That meets the 2 s per-call budget but is a visible stall each call. | V (synthetic) | Chunk the scan and yield every ~10 ms, or move it to a worker. Time a real vault with the probe. |
| R4 | **`num_ctx` changes evict and reload the model.** The scheduler compares runner options (including `NumCtx`, `NumBatch`) and reloads on any difference. The server default context is VRAM-tiered (4k/32k/256k), so omitting it is also non-deterministic. | S | Always send the same `num_ctx` and runner options on every request, from one place. |
| R5 | **Ollama has no pause.** One runner, queue depth 512; a second request waits behind the first. AC-M1.5's "pause" can only be **abort and restart from the last completed step**. | S | Checkpoint at model-call granularity; budget for the lost partial call. |
| R6 | **Memory.** Text plus a lowercase copy of 118 MB of characters used ~194 MB heap (448 MB RSS) with Latin-1 text. V8 stores non-Latin-1 text at 2 bytes/char, so roughly double. | V (synthetic) | Cache lowercase only and slice snippets from disk on demand; or cap/evict. Matters beside a 3+ GB model on an 8 GB machine. |
| R7 | **Plugin ID/name collision.** ID `synapse` is already in the directory (`dustinkeeton/obsidian-synapse`), along with `synapse-ai` ("chat with your notes"), `synapse-vault`, `claude-synapse`, `synapses`. | V (8,297 entries) | Choose a new manifest ID and a more distinctive name before anything ships. |
| R8 | **The substring check validates copying, not support.** It stops invented quotes, but not a real quote attached to a claim it doesn't support. | D | ID-based excerpts guarantee verbatim quotes; support correctness is then measured by the eval (AC-M9.2), not asserted by the check. |
| R9 | **Gutter markers anchored to a line number drift when the user edits.** | D | Anchor by quote text and re-resolve on render. Not investigated further. |
| R10 | **Review/policy.** Developer policies forbid client-side telemetry and require disclosing network use; each plugin is vetted individually. [S] | S | README + settings disclosure (already in spec); keep the grep-based CI check. |

---

## 4. Consolidated recommendations

| # | Decision | Replaces / refines |
|---|---|---|
| D1 | `Transport` interface: Node `http` primary (guarded dynamic import), `requestUrl` for health checks and a degraded mode. No `fetch`. | OQ-1 |
| D2 | Minimum Ollama version = the version the bake-off passes on (floor 0.9.0). No `OLLAMA_ORIGINS` setup step. | OQ-1 |
| D3 | Backlinks by inverting `resolvedLinks`, excluded notes filtered at build time. | OQ-2, OQ-11 |
| D4 | mtime fallback trigger: >50% of notes in any 48 h window. | OQ-3, AC-M7.3 |
| D5 | PDFs via `loadPdfJs()`; **per-page** text-layer detection; bundled `pdfjs-dist` only as contingency (~1.8 MB). | OQ-4, AC-M4.2/4.3 |
| D6 | One production request shape everywhere; pinned GGUF tags and digests; "format ignored" detector. | OQ-5/6, AC-M1.1/1.4 |
| D7 | ≈3-call pipeline with wall-clock budget; `compare` returns excerpt IDs; byte-identical prompt prefix. | AC-M2.3, M3.2, M5.1, M6.8 |
| D8 | Pause = abort + restart from last completed step; cancel = transport abort; fixed `num_ctx`. | AC-M1.5/1.6 |
| D9 | `search_text`: no model regex, cooperative yielding, lowercase-only cache. | R2, R3, R6 |
| D10 | New plugin ID and name. | R7 |

### Suggested spec edits

- **AC-M1.1:** health check uses the identical request shape as production calls and reports "model ignores `format`" separately.
- **AC-M1.5:** "pauses" becomes "aborts the in-flight call and restarts it from the last completed step".
- **AC-M2.3:** add a wall-clock budget alongside the hop cap, with the default hop cap lowered or the loop shape changed per D7.
- **AC-M3.2:** "first visible progress" is a UI state, not a model token. Keep 45 s as a **target** until measured.
- **AC-M4.2/M4.3:** per-page "no text layer" detection; settings lists partially scanned PDFs with page counts.
- **AC-M5.1:** `compare` returns `{relation, reason, excerpt_ids}`; verbatim quotes are filled in by the plugin.
- **AC-M6.8:** cap claims × candidates, or set a floor-tier budget after measurement.
- **AC-M7.3:** replace the 1-hour definition with the 48-hour window.
- **Constraints/Model:** remove "Qwen3-4B-Thinking" and "Gemma-family E4B" as candidates; name Qwen3-4B-Instruct-2507 and Gemma 4 E2B QAT as bake-off entries.
- **Release:** add "choose a unique plugin ID".

---

## 5. Remaining open questions and next steps

### Gates to pass before the design is committed (on-device, about half a day)

**Gate A: bake-off** (`spikes/bakeoff`) on an 8 GB Apple Silicon Mac, per candidate, `--n 100 --num-ctx 4096`.

| Measurement | Pass condition | If it fails |
|---|---|---|
| `structuredOutput.validRate` with `think:false` | 100% after one retry (AC-M1.4/M9.3); `anyThinkingFieldReturned` = false | Drop the model, or check for the #15260 pattern on this Ollama version. |
| `residency.fullyOnGpu` at 4096 (and 8192) | true | Smaller model or context; the 8 GB floor claim is revised. |
| `prefixReuse.verdict` | "prefix reused" | Collapse the pipeline to 2 calls; budgets in §2.6 shift to the "no reuse" row. |
| `cancel.tinyRequestAfterAbortMs` | < 2000 | AC-M1.6 needs a different mechanism (e.g., ask Ollama to unload the model). |
| `numCtxChange.verdict` | "RELOADED" (expected) | None; confirms R4. |
| Median prefill and decode rates | Feed into `latency/budget.py`; Q&A ≤ 45 s at the lean pipeline | Relax the floor-tier budgets or raise the hardware floor. |

**Gate B: probe plugin** in 2–3 real vaults, at least one synced across devices.

| Output field | Settles |
|---|---|
| `transports.*` and `*StreamAbort` | OQ-1: which transports work in the real renderer (Private Network Access, Node integration, abort). |
| `vault.mtime` | OQ-3: the real distribution, including a synced vault. |
| `vault.backlinkInversion`, `cachedReadSample` | OQ-2 and the startup cost of loading 10k notes. |
| `pdf.pdfjsVersion`, `samples[*]` | OQ-4: version, whether text extraction works without the viewer, per-page timing. |

**Gate C: one human question.** Ask the Obsidian plugin-review team whether a desktop-only plugin using a guarded `import('http')` to loopback is acceptable, and what they expect for streaming local-LLM clients.

### Still open after those gates

- **Real model quality:** JSON validity, citation validity, contradiction precision/recall (OQ-7, OQ-10) can only be measured with the fixture vault and a model. The harness here covers validity only.
- **Prefill speed on an 8 GB M1:** I found no trustworthy figure, so every latency conclusion in §2.6 is conditional on it.
- **Gemma 4 E2B memory:** its KV-cache cost wasn't computed (hyperparameters not verified here); the "borderline" verdict needs the bake-off's `residency`.
- **Whether a default `ollama pull` on an 8 GB Mac resolves to an MLX build** (which ignores `format` per #17183). Check on a real Mac.
- **How real sync tools stamp mtime** (OQ-3). Simulated here.
- **Scrolling to a cited passage** (AC-M3.3): `openLinkText` and `OpenViewState.eState` are public, but the keys inside `eState` (e.g. `line`) are undocumented, and the `#page=N` behavior for PDFs needs a 15-minute manual check. [U]
- **Real-PDF extraction cost and the empty-page threshold** (my fixtures were synthetic; real scans carry stray header/footer characters).
- **OQ-8, 9, 14, 15** were not investigated beyond the triage in §2.7.

---

## Appendix A: evidence index

| Claim | Where | Tag |
|---|---|---|
| Stock Ollama 0.35.0 accepts `app://obsidian.md`; rejects other origins | `spikes/cors/RESULT.txt` | V |
| Node `http` streams and aborts promptly (mock) | `spikes/transport/` | V (mock) |
| `fetch` = unsuppressible warning; guarded dynamic `http` = clean | `spikes/obsidian-api/lintdemo/` | V |
| No backlinks API in typings; `requestUrl` has no abort; `loadPdfJs` is public | obsidian 1.13.1 `obsidian.d.ts` | S |
| Backlink inversion 53 ms; search 123–574 ms; 194 MB heap; ReDoS 58 s | `spikes/scale/bench.mjs` | V (synthetic, 1 vCPU) |
| mtime rule on clones and simulated syncs | `spikes/mtime/analyze.mjs` | V / D |
| PDF rule results, 3.8 ms/page, error types, bundle sizes | `spikes/pdf/extract.mjs` | V (synthetic) |
| KV cache, fit table, latency model, compare cost | `spikes/latency/budget.py` | D |
| Harness logic (incl. negative control for cancel) | `spikes/bakeoff/` against a mock | V (mock only) |
| Ollama defaults (`NumParallel=1`, `think` default, reload on option change, `ThinkingClose`) | Ollama v0.35.0: `envconfig/config.go`, `server/routes.go`, `server/sched.go`, `llm/server.go` | S |
| Min versions: `format` 0.5.0, `think` 0.9.0 | Ollama `api/types.go` at v0.4.0 / 0.5.0 / 0.8.0 / 0.9.0 | S |
| Model sizes and Qwen3-4B hyperparameters | ollama.com library pages (gemma4 tags; `qwen3:4b-instruct-2507-q4_K_M` blob) | S |

## Appendix B: sources

- Obsidian: `obsidian` npm 1.13.1 typings; `eslint-plugin-obsidianmd` 0.4.2; docs.obsidian.md/Developer+policies; docs.obsidian.md/oo/plugin (submission checklist); `obsidianmd/obsidian-releases` `community-plugins.json` (8,297 entries).
- Ollama: v0.35.0 source and release binary (live server); ollama.com/library/gemma4/tags; ollama.com/library/qwen3 `4b-instruct-2507-q4_K_M` blob page; GitHub issues #15260, #14645, #15416, #17183, #18441.
- Hardware: llama.cpp discussion #2182 (GPU memory reserve rule) and issue #1870 (usable share on 16/32 GB machines); community M1 8 GB throughput figures (SitePoint, singhajit.com).
- Precedent: `pfrankov/obsidian-ai-providers`, `pfrankov/obsidian-local-gpt`, `brumik/obsidian-ollama-chat`, `hinterdupfinger/obsidian-ollama` (cloned and read); PDF plugin notes (obsidian-text-extract on npm; shiori-bookshelf release notes).
