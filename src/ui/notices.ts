/**
 * Non-blocking notice shell with optional Retry (AC-M1.8).
 * No Obsidian import — composition root injects `present` (e.g. wraps Notice).
 */

import type { Disposable, Observable } from "../core";
import type { QueueStatus } from "../jobs";
import { toStatusVm } from "./viewmodels/status";

export interface NoticePresentation {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export type PresentNotice = (p: NoticePresentation) => void;

export interface MountStatusNoticesOptions {
  status: Observable<QueueStatus>;
  present: PresentNotice;
  /** Optional Retry callback; attached only when the viewmodel asks for Retry. */
  onRetry?: () => void;
}

/**
 * Subscribe to queue status and raise a notice once per error identity edge.
 */
export function mountStatusNotices(opts: MountStatusNoticesOptions): Disposable {
  const { status, present, onRetry } = opts;
  let lastIdentity: string | null = null;

  const onStatus = (s: QueueStatus): void => {
    const vm = toStatusVm(s);
    if (!vm.showNotice || vm.errorIdentity === null || vm.noticeText === null) {
      if (s.model !== "error") {
        lastIdentity = null;
      }
      return;
    }
    if (vm.errorIdentity === lastIdentity) {
      return;
    }
    lastIdentity = vm.errorIdentity;

    const presentation: NoticePresentation = {
      message: vm.noticeText,
    };
    if (vm.showRetry && onRetry !== undefined && vm.retryLabel !== null) {
      presentation.actionLabel = vm.retryLabel;
      presentation.onAction = onRetry;
    }
    present(presentation);
  };

  onStatus(status.get());
  const unsub = status.subscribe(onStatus);
  return () => {
    unsub();
    lastIdentity = null;
  };
}
