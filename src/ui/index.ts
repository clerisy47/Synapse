/**
 * ui — views, status bar, notices, settings (DOM shells + pure viewmodels).
 */

export type { StatusVm } from "./viewmodels/status";
export { toStatusVm } from "./viewmodels/status";

export type { MountStatusBarOptions } from "./status-bar";
export { mountStatusBar } from "./status-bar";

export type {
  MountStatusNoticesOptions,
  NoticePresentation,
  PresentNotice,
} from "./notices";
export { mountStatusNotices } from "./notices";

export { ACTIONS, ERROR_NOTICES, REMEDIATION, STATUS } from "./strings/en";
export { interpolate } from "./strings/t";
