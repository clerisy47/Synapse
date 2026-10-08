/**
 * Status-bar DOM shell (AC-M1.7). No Obsidian import — host injects the element.
 * Merges optional corpus warm progress with job-queue status.
 */

import { CSS_PREFIX } from "../constants";
import type { Disposable, Observable } from "../core";
import type { QueueStatus } from "../jobs";
import {
  toMergedStatusVm,
  type IndexBarStatus,
} from "./viewmodels/status";

export interface MountStatusBarOptions {
  el: HTMLElement;
  status: Observable<QueueStatus>;
  /** When provided, shows indexing progress while corpus is warming. */
  indexStatus?: Observable<IndexBarStatus>;
}

const ROOT = `${CSS_PREFIX}-status-bar`;

function apply(
  el: HTMLElement,
  queue: QueueStatus,
  index: IndexBarStatus | null,
): void {
  const vm = toMergedStatusVm(queue, index);
  el.className = `${ROOT} ${ROOT}--${vm.cssModifier}`;
  el.textContent = vm.barText;
}

/**
 * Bind queue (+ optional index) status to a status-bar element.
 * Returns a dispose that unsubscribes and clears the element.
 */
export function mountStatusBar(opts: MountStatusBarOptions): Disposable {
  const { el, status, indexStatus } = opts;
  let latestQueue = status.get();
  let latestIndex: IndexBarStatus | null = indexStatus
    ? indexStatus.get()
    : null;

  const paint = (): void => {
    apply(el, latestQueue, latestIndex);
  };

  paint();
  const unsubQueue = status.subscribe((s) => {
    latestQueue = s;
    paint();
  });
  const unsubIndex = indexStatus
    ? indexStatus.subscribe((s) => {
        latestIndex = s;
        paint();
      })
    : () => {};

  return () => {
    unsubQueue();
    unsubIndex();
    el.textContent = "";
    el.className = "";
  };
}
