/**
 * Obsidian adapters (DESIGN §2.2). Storage, lifecycle, requestUrl transport,
 * settings tab host.
 */

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
