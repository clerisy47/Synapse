/**
 * ui — views, status bar, notices, settings (DOM shells + pure viewmodels).
 */

export type { ChatStage, ChatHop, ChatCitation, ChatClaim, ChatResult, ChatMessage, ChatState, ChatEvent } from "./viewmodels/chat";
export { initialChatState, reduceChat } from "./viewmodels/chat";
export type { ChatActions, MountChatViewOptions } from "./views/chat-view";
export { mountChatView } from "./views/chat-view";
export { CHAT } from "./strings/en";

export type { IndexBarStatus, StatusCssModifier, StatusVm } from "./viewmodels/status";
export { toMergedStatusVm, toStatusVm } from "./viewmodels/status";

export type {
  HealthInvalidatingKey,
  SettingsChangeEffects,
  SettingsFieldKey,
  SettingsFieldVm,
  SettingsVm,
  SettingsWarningVm,
} from "./viewmodels/settings";
export {
  HEALTH_INVALIDATING_KEYS,
  settingsChangeEffects,
  toSettingsVm,
} from "./viewmodels/settings";

export type { MountStatusBarOptions } from "./status-bar";
export { mountStatusBar } from "./status-bar";

export type {
  MountStatusNoticesOptions,
  NoticePresentation,
  PresentNotice,
} from "./notices";
export { mountStatusNotices } from "./notices";

export type {
  MountSettingsPanelOptions,
  SettingsPanelActions,
  SettingsPatch,
  SettingsTabHost,
} from "./settings-tab";
export {
  SETTINGS_ROOT_CLASS,
  mountSettingsPanel,
} from "./settings-tab";

export {
  ACTIONS,
  ERROR_NOTICES,
  REMEDIATION,
  SETTINGS,
  STATUS,
} from "./strings/en";
export { interpolate } from "./strings/t";

export type {
  CommandDef,
  CommandId,
  M1CommandHandlers,
  M2CommandHandlers,
} from "./commands";
export {
  COMMAND_IDS,
  COMMAND_NAMES,
  createM1Commands,
  createM2Commands,
} from "./commands";
