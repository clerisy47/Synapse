/**
 * Status-bar DOM shell (AC-M1.7). No Obsidian import — host injects the element.
 */

import { CSS_PREFIX } from "../constants";
import type { Disposable, Observable } from "../core";
import type { QueueStatus } from "../jobs";
import { toStatusVm } from "./viewmodels/status";

export interface MountStatusBarOptions {
  el: HTMLElement;
  status: Observable<QueueStatus>;
}

const ROOT = `${CSS_PREFIX}-status-bar`;

function apply(el: HTMLElement, status: QueueStatus): void {
  const vm = toStatusVm(status);
  el.className = `${ROOT} ${ROOT}--${vm.cssModifier}`;
  el.textContent = vm.barText;
}

/**
 * Bind queue status to a status-bar element. Returns a dispose that unsubscribes
 * and clears the element.
 */
export function mountStatusBar(opts: MountStatusBarOptions): Disposable {
  const { el, status } = opts;
  apply(el, status.get());
  const unsub = status.subscribe((s) => {
    apply(el, s);
  });
  return () => {
    unsub();
    el.textContent = "";
    el.className = "";
  };
}
