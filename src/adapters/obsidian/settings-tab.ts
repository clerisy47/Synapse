/**
 * Obsidian settings host + PluginSettingTab registration (DESIGN §5.7 / AC-M8.2).
 * Host is structurally compatible with ui SettingsTabHost; mount is injected so
 * adapters never import ui (dependency-cruiser adapters-deps).
 */

import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";

import type { Disposable } from "../../core";

const DEFAULT_CSS_PREFIX = "syn";

/** Structural host for mountSettingsPanel (no ui import). */
export interface ObsidianSettingsHost {
  clear(): void;
  addSection(title: string): void;
  addWarning(text: string, cssModifier: string): void;
  addTextField(opts: {
    key: string;
    label: string;
    description: string;
    value: string;
    onChange: (value: string) => void;
  }): void;
  addDropdown(opts: {
    key: string;
    label: string;
    description: string;
    value: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    onChange: (value: string) => void;
  }): void;
  addButton(opts: { label: string; onClick: () => void }): void;
}

/** Minimal Setting surface for tests (defaults to Obsidian Setting). */
export type SettingLike = {
  setName(name: string): SettingLike;
  setDesc(desc: string): SettingLike;
  setHeading(): SettingLike;
  addText(cb: (text: TextComponentLike) => void): SettingLike;
  addTextArea(cb: (text: TextComponentLike) => void): SettingLike;
  addDropdown(cb: (dropdown: DropdownComponentLike) => void): SettingLike;
  addButton(cb: (button: ButtonComponentLike) => void): SettingLike;
};

export type TextComponentLike = {
  setValue(value: string): TextComponentLike;
  onChange(cb: (value: string) => void): TextComponentLike;
  inputEl: { type?: string };
};

export type DropdownComponentLike = {
  addOption(value: string, label: string): DropdownComponentLike;
  setValue(value: string): DropdownComponentLike;
  onChange(cb: (value: string) => void): DropdownComponentLike;
};

export type ButtonComponentLike = {
  setButtonText(text: string): ButtonComponentLike;
  onClick(cb: () => void): ButtonComponentLike;
};

export type SettingConstructor = new (containerEl: HTMLElement) => SettingLike;

export type CreateObsidianSettingsHostOptions = {
  containerEl: HTMLElement;
  cssPrefix?: string;
  SettingCtor?: SettingConstructor;
};

type ObsidianEl = HTMLElement & {
  empty?: () => void;
  createDiv?: (opts?: string | { cls?: string }) => HTMLElement;
};

function emptyContainer(el: HTMLElement): void {
  const o = el as ObsidianEl;
  if (typeof o.empty === "function") {
    o.empty();
    return;
  }
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function appendDiv(parent: HTMLElement, cls: string): HTMLElement {
  const o = parent as ObsidianEl;
  if (typeof o.createDiv === "function") {
    return o.createDiv({ cls });
  }
  throw new Error("ObsidianSettingsHost: containerEl.createDiv is required");
}

const MULTILINE_KEYS = new Set(["excludedFolders", "excludedTags"]);

/**
 * Build a SettingsTabHost that paints via Obsidian Setting (textContent/setText).
 */
export function createObsidianSettingsHost(
  opts: CreateObsidianSettingsHostOptions,
): ObsidianSettingsHost {
  const { containerEl } = opts;
  const cssPrefix = opts.cssPrefix ?? DEFAULT_CSS_PREFIX;
  const SettingCtor: SettingConstructor = opts.SettingCtor ?? Setting;
  const rootClass = `${cssPrefix}-settings`;
  const warningClass = `${cssPrefix}-settings-warning`;
  const sectionClass = `${cssPrefix}-settings-section`;

  containerEl.classList?.add?.(rootClass);

  return {
    clear(): void {
      emptyContainer(containerEl);
      containerEl.classList?.add?.(rootClass);
    },

    addSection(title: string): void {
      const heading = appendDiv(containerEl, sectionClass);
      heading.textContent = title;
    },

    addWarning(text: string, cssModifier: string): void {
      const el = appendDiv(
        containerEl,
        `${warningClass} ${warningClass}--${cssModifier}`,
      );
      el.textContent = text;
    },

    addTextField(field): void {
      const setting = new SettingCtor(containerEl)
        .setName(field.label)
        .setDesc(field.description);
      const useArea =
        MULTILINE_KEYS.has(field.key) || field.value.includes("\n");
      if (useArea) {
        setting.addTextArea((text) => {
          text.setValue(field.value).onChange(field.onChange);
        });
      } else {
        setting.addText((text) => {
          if (field.key === "apiKey") {
            text.inputEl.type = "password";
          }
          text.setValue(field.value).onChange(field.onChange);
        });
      }
    },

    addDropdown(field): void {
      new SettingCtor(containerEl)
        .setName(field.label)
        .setDesc(field.description)
        .addDropdown((dropdown) => {
          for (const opt of field.options) {
            dropdown.addOption(opt.value, opt.label);
          }
          dropdown.setValue(field.value).onChange(field.onChange);
        });
    },

    addButton(opts): void {
      new SettingCtor(containerEl).addButton((button) => {
        button.setButtonText(opts.label).onClick(opts.onClick);
      });
    },
  };
}

export type RegisterSettingsTabOptions = {
  plugin: Plugin;
  /** Called each time the tab is shown; return dispose for hide/unload. */
  mount: (containerEl: HTMLElement) => Disposable;
};

/**
 * Register a PluginSettingTab that delegates panel painting to `mount`.
 */
export function registerSettingsTab(
  opts: RegisterSettingsTabOptions,
): Disposable {
  const { plugin, mount } = opts;

  class SynapseSettingsTab extends PluginSettingTab {
    private panelDispose: Disposable | null = null;

    constructor(app: App, plug: Plugin) {
      super(app, plug);
    }

    display(): void {
      this.panelDispose?.();
      this.panelDispose = null;
      emptyContainer(this.containerEl);
      this.panelDispose = mount(this.containerEl);
    }

    hide(): void {
      this.panelDispose?.();
      this.panelDispose = null;
    }
  }

  const tab = new SynapseSettingsTab(plugin.app, plugin);
  plugin.addSettingTab(tab);

  return () => {
    tab.hide();
  };
}
