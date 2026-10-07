/**
 * Obsidian adapters (DESIGN §2.2). Storage, lifecycle, requestUrl transport.
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
