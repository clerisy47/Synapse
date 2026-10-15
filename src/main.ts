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
  showControlReview,
  showResearchReview,
  RequestUrlTransport,
  createChatItemViewFactory,
  createChatOpener,
  createObsidianNavigationFromApp,
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
import { createControlStore, CONTROL_STARTERS, type ControlStore } from "./instructions";
import { createQaPipeline } from "./agent";
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
  VIEW_TYPE_CHAT,
} from "./constants";
import {
  createObservable,
  err,
  synapseError,
  ok,
  type Clock,
  type ActiveNotePort,
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
import { resolveAnchor } from "./evidence";
import { createJobQueue, type JobQueue } from "./jobs";
import {
  OpenRouterClient,
  createOpenRouterHealthChecker,
  type HealthChecker,
  type HealthReport,
} from "./llm";
import { bindToolAccess, guardToolRegistry, createPermittedTextReader, type ToolReadAccess } from "./tools";
import { createAccessRuntime, createEndpointPolicy, createExclusionPolicy, guardNavigation, intersectReadSessions, type AccessRuntime } from "./policy";
import { createResearchInbox, createResearchReviewSession, type ResearchInbox } from "./research";
import { loadStateStore, mergeResearchLedgers, type StateStore } from "./state";
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
  CONTROLS,
  CHAT,
  createChatController,
  createM3Commands,
  createResearchCaptureCommand,
  createResearchReviewCommand,
  mountReviewView,
  type ReviewRunner,
  mountChatView,
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
    changedKeys.includes("controlPaths") ||
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
    controlPaths: Object.values(settings.controlPaths),
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

function buildToolRegistry(raw: CoreToolDeps, access: ToolReadAccess): ToolRegistry {
  const deps = bindToolAccess(raw, access);
  return guardToolRegistry(createToolRegistry({
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
  }), access);
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
  private controls: ControlStore | null = null;
  private research: ResearchInbox | null = null;
  private activeNote: ActiveNotePort | null = null;
  private reviewSession: (() => ReviewRunner | null) | null = null;
  private closeReview: Disposable | null = null;
  private corpus: CorpusStore | null = null;
  private toolDeps: CoreToolDeps | null = null;
  private access: AccessRuntime | null = null;
  private accessUnsub: Disposable | null = null;
  private invalidateChat: (() => void) | null = null;
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
    this.reviewSession = null;
    this.research?.dispose();
    this.research = null;
    this.activeNote = null;
    this.controls?.dispose();
    this.controls = null;
    this.corpus = null;
    this.accessUnsub?.();
    this.accessUnsub = null;
    this.access?.dispose();
    this.access = null;
    this.toolDeps = null;
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
    this.activeNote = activeNote;

    this.installControls(vault, config.get());
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
    const openChat = this.mountChat(jobs);
    this.registerCommands(jobs, openChat);

    const layoutDispose = onLayoutReady(this.app, () => {
      void this.startWarm();
      void this.runQuickHealth();
    });
    this.disposables.push(layoutDispose);
  }

  private installControls(vault: VaultPort, settings: Settings): void {
    this.closeReview?.();
    this.controls?.dispose();
    this.controls = createControlStore({ vault, paths: settings.controlPaths, starters: CONTROL_STARTERS });
    void this.controls.reload();
    this.research?.dispose();
    const state = this.state;
    const activeNote = this.activeNote;
    this.research = state && activeNote ? createResearchInbox({
      vault, activeNote, clock: this.clock, paths: settings.controlPaths,
      readLedger: () => state.get().researchLedger,
      saveLedger: async (ledger) => {
        state.update((s) => { s.researchLedger = mergeResearchLedgers(s.researchLedger, ledger); });
        await state.flush();
      },
    }) : null;
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
    this.toolDeps = buildCoreToolDeps(corpus, vault, this.clock, () => this.state?.get().touchLog ?? {});
    this.accessUnsub?.();
    this.access?.dispose();
    const controls = this.controls!;
    this.access = createAccessRuntime({ vault, metadata, paths: settings.controlPaths,
      exclusion: exclusionFromSettings(settings),
      getDoc: (path) => corpus.reader().get(path),
      getFrontmatter: (path) => corpus.getFrontmatter(path),
      listDocs: () => corpus.reader().list(),
      policy: () => { const state = controls.status.get().security; return state.status === "ready" ? state.snapshot : null; },
      subscribePolicy: (callback) => controls.status.subscribe(callback),
    });
    this.reviewSession = () => {
      const inbox = this.research;
      const activeNote = this.activeNote;
      const lane = this.lane;
      const jobs = this.jobs;
      const config = this.config;
      if (!inbox || !activeNote || !lane || !jobs || !config) return null;
      return createResearchReviewSession({ vault, metadata, activeNote, inbox, jobs, model: lane.client,
        paths: settings.controlPaths,
        exclusion: createExclusionPolicy({ folders: settings.excludedFolders, tags: settings.excludedTags,
          frontmatterKey: EXCLUSION_FRONTMATTER_KEY, frontmatterValue: EXCLUSION_FRONTMATTER_VALUE }),
        controls: () => {
          const status = controls.status.get();
          return status.instructions.status === "ready" && status.security.status === "ready"
            ? { instructions: status.instructions.snapshot, policy: status.security.snapshot } : null;
        },
        version: () => this.lane === lane && this.controls === controls && this.research === inbox ? "current" : "retired",
        subscribeSettings: (callback) => config.subscribe(callback),
        subscribeControls: (callback) => controls.status.subscribe(callback),
      });
    };
    const access = this.access;
    const updateIndexStatus = () => {
      const count = access.internalCount();
      this.indexStatus.set({ phase: corpus.status.get().phase, indexedNotes: count, totalNotes: count, bytesCached: 0 });
    };
    updateIndexStatus();
    this.indexStatusUnsub = corpus.status.subscribe(updateIndexStatus);
    this.invalidateChat?.();
    this.accessUnsub = access.changes.subscribe(() => { updateIndexStatus(); this.invalidateChat?.(); });
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
            ...(JSON.stringify(prev.controlPaths) !== JSON.stringify(next.controlPaths) ? ["controlPaths"] : []),
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
    this.closeReview?.();
    this.lane = buildAiLane(settings, this.clock);
  }

  private rebuildCorpus(settings: Settings): void {
    const vault = this.vault;
    if (!vault) {
      return;
    }
    const metadata = createObsidianMetadataFromApp(this.app);
    this.installControls(vault, settings);
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
    const deps = this.toolDeps;
    const runtime = this.access;
    const security = this.controls?.status.get().security;
    if (!deps || !runtime || security?.status !== "ready") {
      new Notice(`${PLUGIN_NAME}: tools not ready.`);
      return;
    }
    const access = runtime.open({ recipient: "internal", purpose: "search", policyHash: security.snapshot.hash }, "raw-tools");
    const tools = buildToolRegistry(deps, access);
    const ac = new AbortController();
    const outcome = await tools.invoke(
      "list_recent",
      { by: "mtime", days: 30, limit: 20 },
      { signal: ac.signal },
    );
    if (!access.current()) return;
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
                invalidControlPaths: () => presentObsidianNotice({ message: CONTROLS.invalidPaths }),
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

  private mountChat(jobs: JobQueue): () => Promise<void> {
    const chat = createChatController(jobs, (input, ctx, emit) => {
      const lane = this.lane;
      const deps = this.toolDeps;
      const runtime = this.access;
      const security = this.controls?.status.get().security;
      const corpus = this.corpus;
      const vault = this.vault;
      const settings = this.config?.get();
      if (!lane || !deps || !runtime || !corpus || !vault || !settings) {
        return Promise.resolve(err(synapseError({ code: "INTERNAL", message: "Q&A unavailable" })));
      }
      if (security?.status !== "ready") return Promise.resolve(err(synapseError({ code: "ACCESS_DENIED", message: "Security policy unavailable" })));
      const internal = runtime.open({ recipient: "internal", purpose: "chat", policyHash: security.snapshot.hash }, "raw-tools");
      const remote = runtime.open({ recipient: "remote-model", purpose: "chat", policyHash: security.snapshot.hash }, "evidence");
      const access = intersectReadSessions(internal, remote);
      const tools = buildToolRegistry(deps, access);
      return createQaPipeline({
        access,
        model: lane.client,
        tools,
        readText: createPermittedTextReader(deps, access),
        multiTurn: settings.qa.multiTurn,
        budget: { maxHops: settings.qa.maxHops, wallClockMs: settings.qa.wallClockSec * 1000 },
        numCtx: settings.numCtx,
        indexStatus: corpus.status.get(),
      }).run(input, ctx, emit);
    });
    this.invalidateChat = () => chat.invalidate();
    const rawNavigation = createObsidianNavigationFromApp(this.app, (text, quote, hintStart) =>
      resolveAnchor(text, { quote, hintStart, hintLine: 0, textHash: "" }));
    const navigation = guardNavigation(rawNavigation, () => {
      const runtime = this.access;
      const security = this.controls?.status.get().security;
      if (!runtime || security?.status !== "ready") return null;
      return runtime.open({ recipient: "internal", purpose: "chat", policyHash: security.snapshot.hash }, "raw-tools");
    });
    this.registerView(VIEW_TYPE_CHAT, createChatItemViewFactory({
      viewType: VIEW_TYPE_CHAT,
      displayText: CHAT.title,
      mount: (el) => mountChatView({ el, state: chat.state, actions: chat, navigation,
        onNavigationError: () => presentObsidianNotice({ message: CHAT.navigationFailed }),
      }),
    }));
    const openChat = createChatOpener(this.app.workspace, VIEW_TYPE_CHAT);
    const ribbon = this.addRibbonIcon("messages-square", CHAT.openCommand, () => {
      void openChat().catch(() => presentObsidianNotice({ message: CHAT.openFailed }));
    });
    this.disposables.push(() => {
      this.invalidateChat = null;
      chat.dispose();
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
      ribbon.remove();
    });
    return () => openChat().catch(() => presentObsidianNotice({ message: CHAT.openFailed }));
  }

  private registerCommands(jobs: JobQueue, openChat: () => Promise<void>): void {
    try {
      this.addCommand({ id: "control-file-status", name: CONTROLS.statusCommand, callback: () => {
        const state = this.controls?.status.get();
        if (state) presentObsidianNotice({ message: CONTROLS.status(state.instructions.status, state.security.status) });
      } });
      this.addCommand({ id: "review-control-setup", name: CONTROLS.setupCommand, callback: () => {
        const controls = this.controls;
        void controls?.proposeSetup().then((changes) => {
          if (this.controls !== controls) return;
          showControlReview(this.app, CONTROLS.setupHeading, changes.length ? CONTROLS.setupPending : CONTROLS.noMissing, changes);
        }).catch(() => presentObsidianNotice({ message: CONTROLS.failed }));
      } });
      const review = createResearchReviewCommand({
        createSession: () => this.reviewSession?.() ?? null,
        open: (controller, onClose) => showResearchReview(this.app, (el, close) => mountReviewView(el, controller, close), onClose),
        notice: (message) => presentObsidianNotice({ message }),
      });
      this.addCommand(review.command);
      this.closeReview = review.close;
      this.disposables.push(() => { this.closeReview = null; review.dispose(); });
      const researchCommand = createResearchCaptureCommand({ service: () => this.research, notice: (message) => presentObsidianNotice({ message }) });
      this.addCommand(researchCommand);
      const defs = createM3Commands({
        openChat,
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
