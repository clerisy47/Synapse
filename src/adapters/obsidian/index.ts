/**
 * Obsidian adapters (DESIGN §2.2). Storage, lifecycle, requestUrl transport,
 * settings tab host, vault/metadata/active-note ports.
 */

export { createChatOpener, type ChatWorkspace, createChatItemViewFactory, type CreateChatItemViewOptions, type ChatItemView } from "./chat-view";

export {
  bindExternalSettingsChange,
  onLayoutReady,
} from "./lifecycle";

export {
  RequestUrlTransport,
  type EndpointChecker,
  type RequestUrlFn,
  type RequestUrlTransportOptions,
} from "./request-url-transport";

export {
  createObsidianStorage,
  createObsidianStorageFromPlugin,
  resolvePluginRel,
  type CreateObsidianStorageOptions,
  type ObsidianStorage,
  type PluginFolderAdapter,
} from "./storage";

export {
  createObsidianSettingsHost,
  registerSettingsTab,
  type ButtonComponentLike,
  type CreateObsidianSettingsHostOptions,
  type DropdownComponentLike,
  type ObsidianSettingsHost,
  type RegisterSettingsTabOptions,
  type SettingConstructor,
  type SettingLike,
  type TextComponentLike,
} from "./settings-tab";

export {
  createObsidianVault,
  createObsidianVaultFromApp,
  type VaultAdapterSurface,
  type VaultFileLike,
} from "./vault";

export {
  createObsidianMetadata,
  createObsidianMetadataFromApp,
  type CreateObsidianMetadataOptions,
  type FileCacheLike,
  type MetadataCacheSurface,
} from "./metadata";

export {
  createObsidianActiveNote,
  createObsidianActiveNoteFromApp,
  type ActiveEditorLike,
  type ActiveFileLike,
  type ActiveNoteWorkspaceSurface,
} from "./active-note";

export { createObsidianNavigation, createObsidianNavigationFromApp, type NavigationSurface, type ResolveNavigationQuote } from "./navigation";

export { createGateBPlugin, runGateBProbe, type GateBLabels, type GateBReport, type ProbePdfJs, type ProbeLoadingTask, type ProbeTiming } from "./pdfjs-probe";
