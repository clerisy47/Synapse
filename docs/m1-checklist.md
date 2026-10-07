# Milestone 1 — Walking-skeleton checklist

Plugin ID: `vault-synapse` · Desktop only · Phase A: OpenRouter free models.

Use this to verify M1 exit: install, configure, health-check, status, and release artifacts. Local Gate A / Ollama bake-off is **out of scope** (deferred to M9 / M1-T17 deferred).

**Legend:** `[x]` verified in-repo (CI / build / code). `[ ]` operator step in Obsidian (clean vault optional).

---

## 1. Build and artifacts

- [x] `npm run typecheck` exits 0
- [x] `npm run lint` exits 0
- [x] `npm test` exits 0
- [x] `npm run boundaries` exits 0
- [x] `npm run check:network` exits 0
- [x] `npm run check:writes` exits 0
- [x] `npm run check:schema` exits 0
- [x] `npm run build` produces `main.js`
- [x] Deploy set is only `main.js`, `manifest.json`, `styles.css` (plugin folder name = `vault-synapse`)
- [x] `manifest.json`: `id` = `vault-synapse`, `isDesktopOnly: true`, `minAppVersion` ≥ `1.8.7`

**Deploy (dev):**

```bash
npm run build
cp main.js manifest.json styles.css \
  "<Vault>/.obsidian/plugins/vault-synapse/"
```

---

## 2. Fresh install (AC-M1.3)

- [ ] Copy the three artifacts into `<Vault>/.obsidian/plugins/vault-synapse/`
- [ ] Enable **Vault Synapse** under Settings → Community plugins
- [ ] Plugin loads with **no API key** without throwing; AI stays disabled
- [ ] Settings show clear copy to add a key (`Add an API key to enable AI features.`)

---

## 3. Settings

- [ ] **Connection** section: API endpoint, OpenRouter API key, model, context window, provider
- [ ] Default endpoint is OpenRouter base (`https://openrouter.ai/api/v1`)
- [ ] Default model is a pinned `:free` ID (provisional: `qwen/qwen3.8-27b:free`)
- [ ] Egress warning visible: note excerpts leave the machine for OpenRouter
- [ ] Non-allowlisted / blocked endpoints show policy messaging (not silent)
- [ ] Transport mode includes Auto / Node HTTP / requestUrl (degraded)

---

## 4. Health — fail path (AC-M1.1, AC-M1.3)

- [ ] With empty/missing key: layout-ready quick health does not enable AI
- [ ] Command **Run model health check** fails closed with remediation (set / fix API key)
- [ ] Bad key / auth failure surfaces a specific message (not a silent hang)
- [ ] Plugin remains usable (settings, unload) while AI is disabled

---

## 5. Health — pass path (AC-M1.1)

Requires a local OpenRouter key in plugin settings (or `OPENROUTER_API_KEY` for live probe scripts). **Never commit the key.**

- [ ] Paste a valid key → save settings
- [ ] Run **Run model health check**
- [ ] Report covers three facets when the provider is up:
  - **server** — auth / reachability (`GET …/key`)
  - **model** — configured model usable
  - **structured** — production-shaped schema-constrained call returns valid JSON
- [ ] Prefer pinned `:free` over bare `openrouter/free` for stable JSON

---

## 6. Status bar and notices (AC-M1.7, AC-M1.8)

- [ ] Status bar shows idle when no job is running (`Vault Synapse: idle`)
- [ ] Status bar shows running while a health/job is in flight
- [ ] Status bar shows error after a model failure
- [ ] Model errors surface as non-blocking notices with **Retry** where applicable
- [ ] Notices never block the UI thread

---

## 7. Commands

- [ ] Palette: **Run model health check** (`run-health-check`)
- [ ] Palette: **Cancel current job** (`cancel-job`)
- [ ] Cancel stops an in-flight health/job (Node transport abortable; requestUrl = degraded)

---

## 8. Unload / reload smoke (AC-M9.7 path)

- [ ] Disable plugin → no throw
- [ ] Re-enable → loads again
- [ ] Unload cancels jobs and flushes plugin state (no vault note writes)

---

## 9. Privacy and boundaries (AC-M8.3 path)

Verified by scripts (section 1):

- [x] No bare `fetch` outside transport allowlist
- [x] File writes only via storage / plugin-folder path rules
- [x] Layer import boundaries enforced
- [x] Structured-output schema keyword subset enforced
- [x] No telemetry / analytics / update-check calls in `src/`

---

## 10. Out of scope for M1

Do **not** require for M1 exit:

- Vault search tools / corpus indexing (M2)
- Q&A chat sidebar (M3)
- PDF text layer (M4)
- Contradiction flags (M5–M6)
- Resurfacing (M6–M7)
- Local Ollama / Gate A bake-off (M1-T17 deferred; M9)
- Marking any model as “recommended”

---

## Related acceptance criteria

| ID | Summary | How covered |
|----|---------|-------------|
| AC-M1.1 | Health facets + remediation | §§4–5 |
| AC-M1.2 | Never pull models / never auto-purchase credits | Phase A client; settings |
| AC-M1.3 | Load with provider down / key missing | §§2, 4 |
| AC-M1.4 | Schema validate + one retry | Unit tests + health structured facet |
| AC-M1.5–1.6 | Single-lane jobs; cancel | Unit tests; §7 |
| AC-M1.7–1.8 | Status bar + notices | §6 |
| AC-M8.3 / M8.5 path | Privacy greps / plugin-folder writes | §§1, 9 |

---

## Sign-off

| Check | Result |
|-------|--------|
| Automated CI / build / privacy (this doc §1, §9) | Pass (M1-T18 session) |
| Obsidian operator path (§§2–8) | Optional; clean vault recommended |
| M1-T17 Gate A local bake-off | Deferred (AGENTS / PLAN) |
