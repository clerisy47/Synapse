/**
 * Plugin lifecycle helpers for the composition root (DESIGN §6.1).
 * No feature logic — only Obsidian event/bridge wiring.
 */

import type { App, Plugin } from "obsidian";

import type { Disposable } from "../../core";

/**
 * Bridge Obsidian's external `data.json` change hook to StoragePort listeners.
 */
export function bindExternalSettingsChange(
  plugin: Plugin,
  notify: () => void,
): void {
  plugin.onExternalSettingsChange = () => {
    notify();
  };
}

/**
 * Run `cb` when the workspace layout is ready (or immediately if already ready).
 * Disposable suppresses a late callback after unload.
 */
export function onLayoutReady(app: App, cb: () => void): Disposable {
  let disposed = false;
  app.workspace.onLayoutReady(() => {
    if (!disposed) {
      cb();
    }
  });
  return () => {
    disposed = true;
  };
}
