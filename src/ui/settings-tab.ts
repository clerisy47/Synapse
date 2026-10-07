/**
 * Injectable settings panel binder (AC-M8.2).
 * No Obsidian import — host supplies Setting-like controls (wired in M1-T16).
 */

import type { Settings } from "../config";
import { CSS_PREFIX } from "../constants";
import type { Disposable, Observable } from "../core";
import {
  type SettingsFieldKey,
  type SettingsVm,
  toSettingsVm,
} from "./viewmodels/settings";
import { SETTINGS } from "./strings/en";

const ROOT = `${CSS_PREFIX}-settings`;

export type SettingsPatch = Partial<Settings>;

export interface SettingsTabHost {
  clear(): void;
  addSection(title: string): void;
  addWarning(text: string, cssModifier: string): void;
  addTextField(opts: {
    key: SettingsFieldKey;
    label: string;
    description: string;
    value: string;
    onChange: (value: string) => void;
  }): void;
  addDropdown(opts: {
    key: SettingsFieldKey;
    label: string;
    description: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }): void;
  addButton(opts: { label: string; onClick: () => void }): void;
}

export interface SettingsPanelActions {
  /** Apply a partial settings update (persist + notify left to caller). */
  applyPatch: (patch: SettingsPatch) => void;
  /**
   * Acknowledge the current endpoint hostname for Phase B non-loopback use.
   * Typically sets `endpointAckHost` from the endpoint URL.
   */
  acknowledgeEndpoint?: () => void;
}

export interface MountSettingsPanelOptions {
  host: SettingsTabHost;
  settings: Observable<Settings>;
  actions: SettingsPanelActions;
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseNumCtx(text: string): number | null {
  const n = Number(text.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return null;
  }
  return n;
}

function hostnameFromEndpoint(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function applyFieldChange(
  key: SettingsFieldKey,
  value: string,
  applyPatch: (patch: SettingsPatch) => void,
): void {
  switch (key) {
    case "endpoint":
      applyPatch({ endpoint: value });
      return;
    case "apiKey":
      applyPatch({ apiKey: value.length === 0 ? null : value });
      return;
    case "model":
      applyPatch({ model: value });
      return;
    case "numCtx": {
      const n = parseNumCtx(value);
      if (n !== null) {
        applyPatch({ numCtx: n });
      }
      return;
    }
    case "provider":
      if (value === "openrouter" || value === "ollama") {
        applyPatch({ provider: value });
      }
      return;
    case "transport":
      if (value === "auto" || value === "node" || value === "requestUrl") {
        applyPatch({ transport: value });
      }
      return;
    case "excludedFolders":
      applyPatch({ excludedFolders: parseLines(value) });
      return;
    case "excludedTags":
      applyPatch({ excludedTags: parseLines(value) });
      return;
    case "endpointAckHost":
      applyPatch({
        endpointAckHost: value.length === 0 ? null : value,
      });
      return;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

function render(
  host: SettingsTabHost,
  vm: SettingsVm,
  settings: Settings,
  actions: SettingsPanelActions,
): void {
  host.clear();

  for (const warning of vm.warnings) {
    host.addWarning(warning.text, warning.cssModifier);
  }

  host.addSection(SETTINGS.sectionConnection);
  for (const field of vm.fields) {
    if (
      field.key === "transport" ||
      field.key === "excludedFolders" ||
      field.key === "excludedTags"
    ) {
      continue;
    }
    if (field.options) {
      host.addDropdown({
        key: field.key,
        label: field.label,
        description: field.description,
        value: field.value,
        options: field.options,
        onChange: (value) => {
          applyFieldChange(field.key, value, actions.applyPatch);
        },
      });
    } else {
      host.addTextField({
        key: field.key,
        label: field.label,
        description: field.description,
        value: field.value,
        onChange: (value) => {
          applyFieldChange(field.key, value, actions.applyPatch);
        },
      });
    }
  }

  if (vm.acknowledgeLabel && actions.acknowledgeEndpoint) {
    host.addButton({
      label: vm.acknowledgeLabel,
      onClick: () => {
        const hostName = hostnameFromEndpoint(settings.endpoint);
        if (hostName !== null) {
          actions.applyPatch({ endpointAckHost: hostName });
        }
        actions.acknowledgeEndpoint?.();
      },
    });
  }

  host.addSection(SETTINGS.sectionTransport);
  const transport = vm.fields.find((f) => f.key === "transport");
  if (transport?.options) {
    host.addDropdown({
      key: transport.key,
      label: transport.label,
      description: transport.description,
      value: transport.value,
      options: transport.options,
      onChange: (value) => {
        applyFieldChange(transport.key, value, actions.applyPatch);
      },
    });
  }

  host.addSection(SETTINGS.sectionExclusions);
  for (const key of ["excludedFolders", "excludedTags"] as const) {
    const field = vm.fields.find((f) => f.key === key);
    if (!field) continue;
    host.addTextField({
      key: field.key,
      label: field.label,
      description: field.description,
      value: field.value,
      onChange: (value) => {
        applyFieldChange(field.key, value, actions.applyPatch);
      },
    });
  }
}

/**
 * Bind an Observable settings store to an injected settings host.
 * Returns a dispose that unsubscribes and clears the host.
 */
export function mountSettingsPanel(
  opts: MountSettingsPanelOptions,
): Disposable {
  const { host, settings, actions } = opts;

  const paint = (snapshot: Settings): void => {
    render(host, toSettingsVm(snapshot), snapshot, actions);
  };

  paint(settings.get());
  const unsub = settings.subscribe((snapshot) => {
    paint(snapshot);
  });

  return () => {
    unsub();
    host.clear();
  };
}

/** CSS root class for settings panel styling. */
export const SETTINGS_ROOT_CLASS = ROOT;
