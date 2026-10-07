import { describe, expect, it, vi } from "vitest";

import type { Settings } from "../config";
import { DEFAULT_SETTINGS } from "../config";
import { createObservable } from "../core";
import { SETTINGS } from "./strings/en";
import {
  type SettingsTabHost,
  mountSettingsPanel,
} from "./settings-tab";

type RecordedWarning = { text: string; cssModifier: string };
type RecordedField = {
  kind: "text" | "dropdown";
  key: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function createFakeHost(): SettingsTabHost & {
  warnings: RecordedWarning[];
  sections: string[];
  fields: RecordedField[];
  buttons: Array<{ label: string; onClick: () => void }>;
  clearCount: number;
} {
  const state = {
    warnings: [] as RecordedWarning[],
    sections: [] as string[],
    fields: [] as RecordedField[],
    buttons: [] as Array<{ label: string; onClick: () => void }>,
    clearCount: 0,
  };

  return {
    get warnings() {
      return state.warnings;
    },
    get sections() {
      return state.sections;
    },
    get fields() {
      return state.fields;
    },
    get buttons() {
      return state.buttons;
    },
    get clearCount() {
      return state.clearCount;
    },
    clear() {
      state.clearCount += 1;
      state.warnings = [];
      state.sections = [];
      state.fields = [];
      state.buttons = [];
    },
    addSection(title: string) {
      state.sections.push(title);
    },
    addWarning(text: string, cssModifier: string) {
      state.warnings.push({ text, cssModifier });
    },
    addTextField(opts) {
      state.fields.push({
        kind: "text",
        key: opts.key,
        label: opts.label,
        value: opts.value,
        onChange: opts.onChange,
      });
    },
    addDropdown(opts) {
      state.fields.push({
        kind: "dropdown",
        key: opts.key,
        label: opts.label,
        value: opts.value,
        onChange: opts.onChange,
      });
    },
    addButton(opts) {
      state.buttons.push({ label: opts.label, onClick: opts.onClick });
    },
  };
}

describe("mountSettingsPanel", () => {
  it("renders egress warning and connection fields for defaults", () => {
    const host = createFakeHost();
    const store = createObservable<Settings>({ ...DEFAULT_SETTINGS });
    const applyPatch = vi.fn();

    const dispose = mountSettingsPanel({
      host,
      settings: store,
      actions: { applyPatch },
    });

    expect(host.warnings.some((w) => w.text === SETTINGS.egressWarning)).toBe(
      true,
    );
    expect(host.sections).toContain(SETTINGS.sectionConnection);
    expect(host.sections).toContain(SETTINGS.sectionTransport);
    expect(host.sections).toContain(SETTINGS.sectionExclusions);
    expect(host.fields.some((f) => f.key === "endpoint")).toBe(true);
    expect(host.fields.some((f) => f.key === "apiKey")).toBe(true);
    expect(host.fields.some((f) => f.key === "model")).toBe(true);
    expect(host.fields.some((f) => f.key === "transport")).toBe(true);

    dispose();
    expect(host.fields).toHaveLength(0);
    expect(host.warnings).toHaveLength(0);
  });

  it("shows degraded transport warning when transport is requestUrl", () => {
    const host = createFakeHost();
    const store = createObservable<Settings>({
      ...DEFAULT_SETTINGS,
      transport: "requestUrl",
    });

    mountSettingsPanel({
      host,
      settings: store,
      actions: { applyPatch: vi.fn() },
    });

    expect(
      host.warnings.some((w) => w.text === SETTINGS.degradedTransport),
    ).toBe(true);
  });

  it("applies patches from field onChange", () => {
    const host = createFakeHost();
    const store = createObservable<Settings>({ ...DEFAULT_SETTINGS });
    const applyPatch = vi.fn();

    mountSettingsPanel({
      host,
      settings: store,
      actions: { applyPatch },
    });

    const modelField = host.fields.find((f) => f.key === "model");
    expect(modelField).toBeTruthy();
    modelField!.onChange("other/model:free");
    expect(applyPatch).toHaveBeenCalledWith({ model: "other/model:free" });
  });

  it("re-renders on settings changes and dispose unsubscribes", () => {
    const host = createFakeHost();
    const store = createObservable<Settings>({ ...DEFAULT_SETTINGS });
    const dispose = mountSettingsPanel({
      host,
      settings: store,
      actions: { applyPatch: vi.fn() },
    });

    const clearsAfterMount = host.clearCount;
    store.set({ ...DEFAULT_SETTINGS, transport: "requestUrl" });
    expect(host.clearCount).toBeGreaterThan(clearsAfterMount);
    expect(
      host.warnings.some((w) => w.text === SETTINGS.degradedTransport),
    ).toBe(true);

    dispose();
    const clearsAfterDispose = host.clearCount;
    store.set({ ...DEFAULT_SETTINGS, model: "x" });
    expect(host.clearCount).toBe(clearsAfterDispose);
  });

  it("acknowledge button patches endpointAckHost for non-loopback ollama", () => {
    const host = createFakeHost();
    const store = createObservable<Settings>({
      ...DEFAULT_SETTINGS,
      provider: "ollama",
      endpoint: "http://192.168.1.10:11434",
      endpointAckHost: null,
    });
    const applyPatch = vi.fn();
    const acknowledgeEndpoint = vi.fn();

    mountSettingsPanel({
      host,
      settings: store,
      actions: { applyPatch, acknowledgeEndpoint },
    });

    expect(host.buttons.length).toBeGreaterThan(0);
    const ack = host.buttons[0];
    expect(ack).toBeDefined();
    ack?.onClick();
    expect(applyPatch).toHaveBeenCalledWith({
      endpointAckHost: "192.168.1.10",
    });
    expect(acknowledgeEndpoint).toHaveBeenCalled();
  });
});
