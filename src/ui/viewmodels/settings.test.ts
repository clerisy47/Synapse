import { describe, expect, it } from "vitest";

import type { Settings } from "../../config";
import { DEFAULT_SETTINGS } from "../../config";
import { SETTINGS } from "../strings/en";
import {
  settingsChangeEffects,
  toSettingsVm,
} from "./settings";

function settings(partial: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...partial };
}

describe("settingsChangeEffects", () => {
  it("invalidates health for endpoint, model, and numCtx", () => {
    expect(settingsChangeEffects(["endpoint"]).invalidatesHealth).toBe(true);
    expect(settingsChangeEffects(["model"]).invalidatesHealth).toBe(true);
    expect(settingsChangeEffects(["numCtx"]).invalidatesHealth).toBe(true);
  });

  it("does not invalidate health for exclusions or transport", () => {
    expect(settingsChangeEffects(["excludedFolders"]).invalidatesHealth).toBe(
      false,
    );
    expect(settingsChangeEffects(["excludedTags"]).invalidatesHealth).toBe(
      false,
    );
    expect(settingsChangeEffects(["transport"]).invalidatesHealth).toBe(false);
    expect(settingsChangeEffects(["apiKey"]).invalidatesHealth).toBe(false);
  });

  it("invalidates when any listed key is health-related", () => {
    expect(
      settingsChangeEffects(["excludedFolders", "model"]).invalidatesHealth,
    ).toBe(true);
  });
});

describe("toSettingsVm", () => {
  it("shows egress warning for default OpenRouter endpoint", () => {
    const vm = toSettingsVm(settings());
    expect(vm.showEgressWarning).toBe(true);
    expect(vm.showNonLoopbackWarning).toBe(false);
    expect(vm.showEndpointBlocked).toBe(false);
    expect(vm.warnings.some((w) => w.kind === "egress")).toBe(true);
    expect(vm.warnings.find((w) => w.kind === "egress")?.text).toBe(
      SETTINGS.egressWarning,
    );
  });

  it("hides egress warning for ollama provider", () => {
    const vm = toSettingsVm(
      settings({
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434",
      }),
    );
    expect(vm.showEgressWarning).toBe(false);
  });

  it("shows non-loopback warning when ollama host is unacked", () => {
    const vm = toSettingsVm(
      settings({
        provider: "ollama",
        endpoint: "http://192.168.1.10:11434",
        endpointAckHost: null,
      }),
    );
    expect(vm.showNonLoopbackWarning).toBe(true);
    expect(vm.showEndpointBlocked).toBe(false);
    expect(vm.acknowledgeLabel).toBeTruthy();
    expect(vm.warnings.some((w) => w.kind === "non_loopback")).toBe(true);
  });

  it("clears non-loopback warning when host is acknowledged", () => {
    const vm = toSettingsVm(
      settings({
        provider: "ollama",
        endpoint: "http://192.168.1.10:11434",
        endpointAckHost: "192.168.1.10",
      }),
    );
    expect(vm.showNonLoopbackWarning).toBe(false);
    expect(vm.showEndpointBlocked).toBe(false);
    expect(vm.acknowledgeLabel).toBeNull();
  });

  it("shows endpoint blocked for non-allowlisted OpenRouter URL", () => {
    const vm = toSettingsVm(
      settings({ endpoint: "https://evil.example/api" }),
    );
    expect(vm.showEgressWarning).toBe(false);
    expect(vm.showEndpointBlocked).toBe(true);
    expect(vm.warnings.some((w) => w.kind === "endpoint_blocked")).toBe(true);
  });

  it("shows degraded transport warning only for requestUrl", () => {
    expect(toSettingsVm(settings({ transport: "auto" })).showDegradedTransport).toBe(
      false,
    );
    expect(toSettingsVm(settings({ transport: "node" })).showDegradedTransport).toBe(
      false,
    );
    const degraded = toSettingsVm(settings({ transport: "requestUrl" }));
    expect(degraded.showDegradedTransport).toBe(true);
    expect(degraded.warnings.some((w) => w.kind === "degraded_transport")).toBe(
      true,
    );
    expect(
      degraded.warnings.find((w) => w.kind === "degraded_transport")?.text,
    ).toBe(SETTINGS.degradedTransport);
  });

  it("flags missing API key for OpenRouter", () => {
    expect(toSettingsVm(settings({ apiKey: null })).missingApiKey).toBe(true);
    expect(toSettingsVm(settings({ apiKey: "" })).missingApiKey).toBe(true);
    expect(toSettingsVm(settings({ apiKey: "sk-test" })).missingApiKey).toBe(
      false,
    );
  });

  it("never puts API key material into warning strings", () => {
    const secret = "sk-live-super-secret-key-do-not-leak";
    const vm = toSettingsVm(settings({ apiKey: secret }));
    for (const warning of vm.warnings) {
      expect(warning.text).not.toContain(secret);
    }
    for (const field of vm.fields) {
      if (field.key === "apiKey") {
        expect(field.value).toBe(secret);
      } else {
        expect(field.value).not.toContain(secret);
        expect(field.description).not.toContain(secret);
        expect(field.label).not.toContain(secret);
      }
    }
    expect(vm.hasTelemetryToggle).toBe(false);
  });

  it("exposes no telemetry toggle", () => {
    expect(toSettingsVm(settings()).hasTelemetryToggle).toBe(false);
  });

  it("includes connection and exclusion fields", () => {
    const vm = toSettingsVm(
      settings({
        excludedFolders: ["Private"],
        excludedTags: ["secret"],
      }),
    );
    const keys = vm.fields.map((f) => f.key);
    expect(keys).toContain("endpoint");
    expect(keys).toContain("apiKey");
    expect(keys).toContain("model");
    expect(keys).toContain("numCtx");
    expect(keys).toContain("transport");
    expect(keys).toContain("excludedFolders");
    expect(keys).toContain("excludedTags");
    expect(vm.fields.find((f) => f.key === "excludedFolders")?.value).toBe(
      "Private",
    );
    expect(vm.fields.find((f) => f.key === "excludedTags")?.value).toBe(
      "secret",
    );
  });
});
