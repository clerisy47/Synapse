/**
 * Composition root (DESIGN §2 / §6.1). Wiring only — no feature logic.
 * M1-T16 + M2-T10: adapters → config/state → corpus/tools → llm/jobs → UI.
 */

import { Notice, Plugin } from "obsidian";

import {
  NodeHttpTransport,
  type EndpointChecker as NodeEndpointChecker,
} from "./adapters/node";
import {
  RequestUrlTransport,
  bindExternalSettingsChange,
  createObsidianActiveNoteFromApp,
  createObsidianMetadataFromApp,
  createObsidianSettingsHost,
  createObsidianStorageFromPlugin,
  createObsidianVaultFromApp,
  onLayoutReady,
  registerSettingsTab,
  type EndpointChecker as RequestUrlEndpointChecker,
} from "./adapters/obsidian";
import {
  createConfigStore,
  parseSettings,
  type ConfigStore,
  type Settings,
  type TransportMode,
} from "./config";
import {
  EXCLUSION_FRONTMATTER_KEY,
  EXCLUSION_FRONTMATTER_VALUE,
  OPENROUTER_API_KEY_ENV,
  PLUGIN_NAME,
  SLICE_MS,
} from "./constants";
import {
  createObservable,
  ok,
  type Clock,
  type Disposable,
  type MutableObservable,
  type Transport,
  type VaultPath,
  type VaultPort,
} from "./core";
import {
  createCorpusStore,
  emptyCorpusStatus,
  type CorpusStatus,
  type CorpusStore,
} from "./corpus";
import { createJobQueue, type JobQueue } from "./jobs";
import {
  OpenRouterClient,
  createOpenRouterHealthChecker,
  type HealthChecker,
  type HealthReport,
} from "./llm";
import { createEndpointPolicy, createExclusionPolicy } from "./policy";
import { loadStateStore, type StateStore } from "./state";
import {
  SEARCH_TEXT_BUDGET_MS,
  createGetBacklinksHandler,
  createGetFrontmatterHandler,
  createGetLinksHandler,
  createListRecentHandler,
  createReadNoteHandler,
  createSearchByTagHandler,
  createSearchByTitleHandler,
  createSearchTextHandler,
  createToolRegistry,
  type CoreToolDeps,
  type ListRecentResult,
  type ToolRegistry,
} from "./tools";
import {
  createM2Commands,
  mountSettingsPanel,
  mountStatusBar,
  mountStatusNotices,
  settingsChangeEffects,
  type NoticePresentation,
  type SettingsPatch,
} from "./ui";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Wall / mono clock for the desktop plugin process. */
function createSystemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },
    mono(): number {
      return performance.now();
    },
    todayLocal(): string {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    },
    sleep(ms: number, signal?: AbortSignal): Promise<void> {
      if (ms <= 0) return Promise.resolve();
      if (signal?.aborted) {
        return Promise.reject(abortError(signal));
      }
      return new Promise((resolve, reject) => {
        const id = window.setTimeout(() => {
          cleanup();
          resolve();
        }, ms);
        const onAbort = (): void => {
          cleanup();
          reject(abortError(signal));
        };
        const cleanup = (): void => {
          window.clearTimeout(id);
          signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    yieldNow(): Promise<void> {
      return new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
    },
  };
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

/** Settings key first; else OPENROUTER_API_KEY env (dev). Never log the value. */
function resolveApiKey(settings: Settings): string | null {
  if (settings.apiKey !== null && settings.apiKey.length > 0) {
    return settings.apiKey;
  }
  try {
    const env = process.env?.[OPENROUTER_API_KEY_ENV];
    if (typeof env === "string" && env.trim().length > 0) {
      return env.trim();
    }
  } catch {
    // process may be unavailable in some renderers
  }
  return null;
}

function createTransport(
  mode: TransportMode,
  checkEndpoint: NodeEndpointChecker & RequestUrlEndpointChecker,
): Transport {
  if (mode === "requestUrl") {
    return new RequestUrlTransport({ checkEndpoint });
  }
  // auto and node → Node HTTP (desktop; abort + stream).
  return new NodeHttpTransport({ checkEndpoint });
}

function endpointCheckerFor(settings: Settings): NodeEndpointChecker {
  const policy = createEndpointPolicy({
    provider: settings.provider,
    endpointAckHost: settings.endpointAckHost,
  });
  return (url: string) => {
    policy.assertAllowed(url);
  };
}

type AiLane = {
  transport: Transport;
  client: OpenRouterClient;
  health: HealthChecker;
};

function buildAiLane(settings: Settings, clock: Clock): AiLane {
  const checkEndpoint = endpointCheckerFor(settings);
  const transport = createTransport(settings.transport, checkEndpoint);
  const apiKey = resolveApiKey(settings);
  const client = new OpenRouterClient({
    transport,
    endpoint: settings.endpoint,
    model: settings.model,
    apiKey,
  });
  const health = createOpenRouterHealthChecker(client, {
    transport,
    endpoint: settings.endpoint,
    modelId: settings.model,
    apiKey,
    numCtx: settings.numCtx,
    clock,
  });
  return { transport, client, health };
}

function patchKeys(patch: SettingsPatch): string[] {
  return Object.keys(patch);
}

function shouldRebuildAi(changedKeys: readonly string[]): boolean {
  if (settingsChangeEffects(changedKeys).invalidatesHealth) {
    return true;
  }
  for (const key of changedKeys) {
    if (
      key === "apiKey" ||
      key === "transport" ||
      key === "provider" ||
      key === "endpointAckHost"
    ) {
      return true;
    }
  }
  return false;
}

function shouldRebuildCorpus(changedKeys: readonly string[]): boolean {
  return (
    changedKeys.includes("excludedFolders") ||
    changedKeys.includes("excludedTags")
  );
}

function presentObsidianNotice(p: NoticePresentation): void {
  const notice = new Notice(p.message, 8_000);
  if (p.actionLabel !== undefined && p.onAction !== undefined) {
    const row = notice.messageEl.createDiv({ cls: "syn-notice-actions" });
    const btn = row.createEl("button", { text: p.actionLabel });
    btn.addEventListener("click", () => {
      p.onAction?.();
      notice.hide();
    });
  }
}

function exclusionFromSettings(settings: Settings) {
  return createExclusionPolicy({
    folders: settings.excludedFolders,
    tags: settings.excludedTags,
    frontmatterKey: EXCLUSION_FRONTMATTER_KEY,
    frontmatterValue: EXCLUSION_FRONTMATTER_VALUE,
  });
}

function buildCoreToolDeps(
  store: CorpusStore,
  vault: VaultPort,
  clock: Clock,
  touchLog: () => Record<VaultPath, number>,
): CoreToolDeps {
  return {
    getDoc(path) {
      return store.reader().get(path);
    },
    listDocs() {
      return store.reader().list();
    },
    scanText(opts) {
      return store.indexes().text.scan(opts);
    },
    searchTitles(query) {
      return store.indexes().title.search(query);
    },
    readText(path) {
      return vault.readText(path);
    },
    outgoing(path) {
      return store.indexes().links.outgoing(path);
    },
    incoming(path) {
      return store.indexes().links.incoming(path);
    },
    unresolvedCount(path) {
      return store.unresolvedCount(path);
    },
    pathsForTag(tag, opts) {
      return store.indexes().tag.pathsForTag(tag, opts);
    },
    getFrontmatter(path) {
      return store.getFrontmatter(path);
    },
    lastTouchedAt(path) {
      const session = store.session().lastTouched(path);
      const persisted = touchLog()[path];
      if (session === undefined) {
        return persisted;
      }
      if (persisted === undefined) {
        return session;
      }
      return Math.max(session, persisted);
    },
    clock,
    sliceMs: SLICE_MS,
    budgetMs: SEARCH_TEXT_BUDGET_MS,
  };
}

function buildToolRegistry(deps: CoreToolDeps): ToolRegistry {
  return createToolRegistry({
    handlers: {
      search_text: createSearchTextHandler(deps),
      search_by_title: createSearchByTitleHandler(deps),
      search_by_tag: createSearchByTagHandler(deps),
      get_links: createGetLinksHandler(deps),
      get_backlinks: createGetBacklinksHandler(deps),
      get_frontmatter: createGetFrontmatterHandler(deps),
      list_recent: createListRecentHandler(deps),
      read_note: createReadNoteHandler(deps),
    },
  });
}

/** Composition root only — wiring lands here. Keep load cheap and throw-free (AC-M1.3). */
export default class VaultSynapsePlugin extends Plugin {
  private readonly disposables: Disposable[] = [];
  private clock: Clock = createSystemClock();
  private state: StateStore | null = null;
  private config: ConfigStore | null = null;
  private jobs: JobQueue | null = null;
  private lane: AiLane | null = null;
  private vault: VaultPort | null = null;
  private corpus: CorpusStore | null = null;
  private tools: ToolRegistry | null = null;
  private warmAbort: AbortController | null = null;
  /** Stable forwarder so status bar survives corpus rebuilds. */
  private readonly indexStatus: MutableObservable<CorpusStatus> =
    createObservable(emptyCorpusStatus());
  private indexStatusUnsub: Disposable | null = null;

  async onload(): Promise<void> {
    try {
      await this.bootstrap();
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: failed to load`, cause);
      new Notice(
        `${PLUGIN_NAME}: failed to initialize. Check the developer console.`,
      );
    }
  }

  onunload(): void {
    if (this.warmAbort) {
      this.warmAbort.abort();
      this.warmAbort = null;
    }
    for (const d of this.disposables.splice(0).reverse()) {
      try {
        d();
      } catch {
        // best-effort unload
      }
    }
    this.indexStatusUnsub?.();
    this.indexStatusUnsub = null;
    try {
      this.corpus?.dispose();
    } catch {
      // ignore
    }
    this.corpus = null;
    this.tools = null;
    this.vault = null;
    try {
      this.jobs?.dispose();
    } catch {
      // ignore
    }
    this.jobs = null;
    this.lane = null;
    const state = this.state;
    this.state = null;
    this.config = null;
    if (state) {
      void state.flush().finally(() => {
        state.dispose();
      });
    }
  }

  private async bootstrap(): Promise<void> {
    const clock = this.clock;

    const storage = createObsidianStorageFromPlugin(this);

    const { store: state } = await loadStateStore({ storage, clock });
    this.state = state;

    const config = createConfigStore(state.get().settings);
    this.config = config;

    this.lane = buildAiLane(config.get(), clock);
    const jobs = createJobQueue({
      clock,
      abortable: this.lane.transport.capabilities.abortable,
    });
    this.jobs = jobs;

    const vault = createObsidianVaultFromApp(this.app);
    const metadata = createObsidianMetadataFromApp(this.app);
    const activeNote = createObsidianActiveNoteFromApp(this.app);
    this.vault = vault;

    this.installCorpus(vault, metadata, config.get());

    this.disposables.push(
      activeNote.onActivity((e) => {
        this.onUserActivity(e.path);
      }),
    );

    bindExternalSettingsChange(this, () => {
      void this.onExternalSettings();
    });

    this.mountUi(config, jobs);
    this.registerCommands(jobs);

    const layoutDispose = onLayoutReady(this.app, () => {
      void this.startWarm();
      void this.runQuickHealth();
    });
    this.disposables.push(layoutDispose);
  }

  private installCorpus(
    vault: VaultPort,
    metadata: ReturnType<typeof createObsidianMetadataFromApp>,
    settings: Settings,
  ): void {
    this.indexStatusUnsub?.();
    this.indexStatusUnsub = null;
    this.corpus?.dispose();
    const corpus = createCorpusStore({
      vault,
      metadata,
      exclusion: exclusionFromSettings(settings),
      clock: this.clock,
      sliceMs: SLICE_MS,
    });
    this.corpus = corpus;
    this.indexStatus.set(corpus.status.get());
    this.indexStatusUnsub = corpus.status.subscribe((s) => {
      this.indexStatus.set(s);
    });
    this.tools = buildToolRegistry(
      buildCoreToolDeps(corpus, vault, this.clock, () => this.state?.get().touchLog ?? {}),
    );
  }

  private onUserActivity(path: VaultPath): void {
    const at = this.clock.now();
    this.corpus?.session().touch(path, at);
    const state = this.state;
    if (!state) {
      return;
    }
    state.update((s) => {
      const prev = s.touchLog[path];
      if (prev === undefined || at >= prev) {
        s.touchLog[path] = at;
      }
    });
  }

  private async startWarm(): Promise<void> {
    const corpus = this.corpus;
    if (!corpus) {
      return;
    }
    if (this.warmAbort) {
      this.warmAbort.abort();
    }
    const local = new AbortController();
    this.warmAbort = local;
    try {
      await corpus.warm(local.signal);
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: corpus warm failed`, cause);
    } finally {
      if (this.warmAbort === local) {
        this.warmAbort = null;
      }
    }
  }

  private async onExternalSettings(): Promise<void> {
    const state = this.state;
    const config = this.config;
    if (!state || !config) return;
    try {
      await state.reloadAndMerge();
      const prev = config.get();
      const next = parseSettings(state.get().settings);
      config.set(next);
      this.rebuildAi(next);
      if (
        shouldRebuildCorpus(
          [
            ...(prev.excludedFolders.join("\0") !==
            next.excludedFolders.join("\0")
              ? (["excludedFolders"] as const)
              : []),
            ...(prev.excludedTags.join("\0") !== next.excludedTags.join("\0")
              ? (["excludedTags"] as const)
              : []),
          ],
        )
      ) {
        this.rebuildCorpus(next);
      }
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: external settings reload failed`, cause);
    }
  }

  private rebuildAi(settings: Settings): void {
    this.lane = buildAiLane(settings, this.clock);
  }

  private rebuildCorpus(settings: Settings): void {
    const vault = this.vault;
    if (!vault) {
      return;
    }
    const metadata = createObsidianMetadataFromApp(this.app);
    this.installCorpus(vault, metadata, settings);
    void this.startWarm();
  }

  private applySettingsPatch(patch: SettingsPatch): void {
    const config = this.config;
    const state = this.state;
    if (!config || !state) return;

    const keys = patchKeys(patch);
    const next = parseSettings({ ...config.get(), ...patch });
    config.set(next);
    state.update((s) => {
      s.settings = next;
      s.settingsUpdatedAt = this.clock.now();
    });
    if (shouldRebuildAi(keys)) {
      this.rebuildAi(next);
    }
    if (shouldRebuildCorpus(keys)) {
      this.rebuildCorpus(next);
    }
  }

  private submitHealthCheck(): void {
    const jobs = this.jobs;
    const lane = this.lane;
    if (!jobs || !lane) return;

    jobs.submit<HealthReport>({
      kind: "health",
      label: "health-check",
      dedupeKey: "health-full",
      run: async (ctx) => {
        const report = await lane.health.full(ctx.signal);
        return ok(report);
      },
    });
  }

  private async runQuickHealth(): Promise<void> {
    const lane = this.lane;
    if (!lane) return;
    try {
      await lane.health.quick();
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: quick health failed`, cause);
    }
  }

  private async debugListRecent(): Promise<void> {
    const tools = this.tools;
    if (!tools) {
      new Notice(`${PLUGIN_NAME}: tools not ready.`);
      return;
    }
    const ac = new AbortController();
    const outcome = await tools.invoke(
      "list_recent",
      { by: "mtime", days: 30, limit: 20 },
      { signal: ac.signal },
    );
    if (!outcome.ok) {
      new Notice(`${PLUGIN_NAME}: list_recent failed (${outcome.error.code}).`);
      return;
    }
    const data = outcome.data as ListRecentResult;
    const paths = data.items.map((item) => item.ref.path);
    const summary =
      paths.length === 0
        ? `${PLUGIN_NAME}: list_recent → 0 notes`
        : `${PLUGIN_NAME}: list_recent → ${paths.length}: ${paths.join(", ")}`;
    new Notice(summary, 10_000);
  }

  private mountUi(config: ConfigStore, jobs: JobQueue): void {
    try {
      const statusEl = this.addStatusBarItem();
      this.disposables.push(
        mountStatusBar({
          el: statusEl,
          status: jobs.status,
          indexStatus: this.indexStatus,
        }),
      );
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: status bar failed`, cause);
    }

    try {
      this.disposables.push(
        mountStatusNotices({
          status: jobs.status,
          present: presentObsidianNotice,
          onRetry: () => {
            this.submitHealthCheck();
          },
        }),
      );
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: notices failed`, cause);
    }

    try {
      this.disposables.push(
        registerSettingsTab({
          plugin: this,
          mount: (containerEl) => {
            const host = createObsidianSettingsHost({ containerEl });
            return mountSettingsPanel({
              host,
              settings: config,
              actions: {
                applyPatch: (p) => {
                  this.applySettingsPatch(p);
                },
              },
            });
          },
        }),
      );
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: settings tab failed`, cause);
      new Notice(`${PLUGIN_NAME}: settings tab failed to load.`);
    }
  }

  private registerCommands(jobs: JobQueue): void {
    try {
      const defs = createM2Commands({
        runHealthCheck: () => {
          this.submitHealthCheck();
        },
        cancelJob: () => {
          jobs.cancelAll();
        },
        debugListRecent: () => this.debugListRecent(),
      });
      for (const def of defs) {
        this.addCommand({
          id: def.id,
          name: def.name,
          callback: () => {
            void def.callback();
          },
        });
      }
    } catch (cause) {
      console.error(`${PLUGIN_NAME}: commands failed`, cause);
    }
  }
}
