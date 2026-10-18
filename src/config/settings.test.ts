import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  createConfigStore,
  migrateSettings,
  parseSettings,
  settingsSchema,
} from "./index";
import {
  DEFAULT_BONSAI_ENDPOINT,
  DEFAULT_BONSAI_MODEL,
} from "../constants";

describe("DEFAULT_SETTINGS", () => {
  it("uses local Bonsai endpoint and 9B alias", () => {
    expect(DEFAULT_SETTINGS.endpoint).toBe(DEFAULT_BONSAI_ENDPOINT);
    expect(DEFAULT_SETTINGS.model).toBe(DEFAULT_BONSAI_MODEL);
    expect(DEFAULT_SETTINGS.provider).toBe("bonsai");
    expect(DEFAULT_SETTINGS.apiKey).toBeNull();
    expect(DEFAULT_SETTINGS.numCtx).toBe(4096);
    expect(DEFAULT_SETTINGS.transport).toBe("auto");
    expect(DEFAULT_SETTINGS.logLevel).toBe("warn");
  });

  it("satisfies the strict settings schema", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("parseSettings", () => {
  it("upgrades the retired Bonsai alias without changing other settings", () => {
    const raw = { ...DEFAULT_SETTINGS, model: "bonsai-2-4b", numCtx: 8192 };
    expect(parseSettings(raw)).toEqual({ ...raw, model: "bonsai-2-9b" });
    expect(raw.model).toBe("bonsai-2-4b");
    expect(parseSettings({ ...raw, provider: "openrouter" }).model).toBe("bonsai-2-4b");
    expect(parseSettings({ ...raw, model: "custom-local" }).model).toBe("custom-local");
  });
  it("returns defaults for non-object roots", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("bad")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per-field for wrong types", () => {
    const parsed = parseSettings({
      endpoint: 123,
      provider: "cloudflare",
      apiKey: 1,
      model: null,
      numCtx: "nope",
      transport: "websocket",
      excludedFolders: "Inbox",
      qa: { multiTurn: "yes", maxHops: false },
      logLevel: "trace",
    });

    expect(parsed.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
    expect(parsed.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(parsed.apiKey).toBe(DEFAULT_SETTINGS.apiKey);
    expect(parsed.model).toBe(DEFAULT_SETTINGS.model);
    expect(parsed.numCtx).toBe(DEFAULT_SETTINGS.numCtx);
    expect(parsed.transport).toBe(DEFAULT_SETTINGS.transport);
    expect(parsed.excludedFolders).toEqual([]);
    expect(parsed.qa.multiTurn).toBe(DEFAULT_SETTINGS.qa.multiTurn);
    expect(parsed.qa.maxHops).toBe(DEFAULT_SETTINGS.qa.maxHops);
    expect(parsed.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
  });

  it("clamps out-of-range integers instead of resetting to defaults", () => {
    const parsed = parseSettings({
      providerRevision: 1,
      numCtx: 99999,
      qa: { maxHops: 1, wallClockSec: 500 },
    });

    expect(parsed.numCtx).toBe(SETTINGS_BOUNDS.numCtx.max);
    expect(parsed.qa.maxHops).toBe(SETTINGS_BOUNDS.qaMaxHops.min);
    expect(parsed.qa.wallClockSec).toBe(SETTINGS_BOUNDS.qaWallClockSec.max);
  });

  it("accepts valid http(s) endpoints and rejects others", () => {
    expect(parseSettings({ providerRevision: 1, provider: "openrouter", endpoint: "https://openrouter.ai/api/v1" }).endpoint).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(parseSettings({ endpoint: "http://127.0.0.1:11434" }).endpoint).toBe(
      "http://127.0.0.1:11434",
    );
    expect(parseSettings({ endpoint: "ftp://example.com" }).endpoint).toBe(
      DEFAULT_SETTINGS.endpoint,
    );
    expect(parseSettings({ endpoint: "not-a-url" }).endpoint).toBe(
      DEFAULT_SETTINGS.endpoint,
    );
  });

  it("keeps only string elements in exclusion arrays", () => {
    const parsed = parseSettings({
      excludedFolders: ["Private", 1, null, "Archive"],
      excludedTags: ["secret"],
    });
    expect(parsed.excludedFolders).toEqual(["Private", "Archive"]);
    expect(parsed.excludedTags).toEqual(["secret"]);
  });

  it("fills nested defaults when intermediate objects are missing", () => {
    const parsed = parseSettings({
      model: "custom/model:free",
      contradiction: { onIdle: { enabled: true } },
    });
    expect(parsed.model).toBe("custom/model:free");
    expect(parsed.qa).toEqual(DEFAULT_SETTINGS.qa);
    expect(parsed).not.toHaveProperty("contradiction");
    expect(parsed).not.toHaveProperty("resurface");
  });

  it("never throws on hostile blobs", () => {
    expect(() => parseSettings({ qa: null, contradiction: [], resurface: 0 })).not.toThrow();
  });
});

describe("migrateSettings", () => {
  it("drops retired feature settings while preserving search and provider configuration", () => {
    const raw = { ...DEFAULT_SETTINGS, model: "custom/model", excludedFolders: ["Private"], excludedTags: ["secret"],
      qa: { multiTurn: true, maxHops: 8, wallClockSec: 60 },
      contradiction: { onIdle: { enabled: true } }, resurface: { enabled: true, staleDays: 30 } };
    const snapshot = JSON.stringify(raw);
    const parsed = parseSettings(raw);
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, model: "custom/model", excludedFolders: ["Private"], excludedTags: ["secret"], qa: raw.qa });
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(parseSettings(parsed)).toEqual(parsed);
  });
  it("moves legacy cloud defaults to local without mutation", () => {
    const raw = { provider: "openrouter", model: "qwen/qwen3.8-27b:free", unknown: 42 };
    expect(migrateSettings(raw)).toMatchObject({ provider: "bonsai", model: DEFAULT_BONSAI_MODEL, endpoint: DEFAULT_BONSAI_ENDPOINT, unknown: 42 });
    expect(raw.model).toBe("qwen/qwen3.8-27b:free");
    expect(parseSettings(raw).model).toBe(DEFAULT_BONSAI_MODEL);
    expect(parseSettings({ model: raw.model }).model).toBe(DEFAULT_BONSAI_MODEL);
    expect(migrateSettings({ ...raw, provider: "ollama" })).toEqual({ ...raw, provider: "ollama" });
  });
  it("preserves unrelated settings and non-object input", () => {
    const raw = { model: "x" };
    expect(migrateSettings(raw)).toBe(raw);
    expect(migrateSettings(null)).toBeNull();
  });
});

describe("createConfigStore", () => {
  it("initializes from defaults when raw is omitted", () => {
    const store = createConfigStore();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("parses unknown raw on construct", () => {
    const store = createConfigStore({ numCtx: 100000, model: "m" });
    expect(store.get().numCtx).toBe(SETTINGS_BOUNDS.numCtx.max);
    expect(store.get().model).toBe("m");
  });

  it("notifies subscribers on set", () => {
    const store = createConfigStore();
    const cb = vi.fn();
    const dispose = store.subscribe(cb);
    const next = parseSettings({ ...store.get(), logLevel: "debug" });
    store.set(next);
    expect(cb).toHaveBeenCalledWith(next);
    expect(store.get().logLevel).toBe("debug");
    dispose();
    store.set(DEFAULT_SETTINGS);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

it("normalizes configured control paths and safely migrates absent/invalid paths", () => {
  expect(parseSettings({}).controlPaths).toEqual(DEFAULT_SETTINGS.controlPaths);
  expect(parseSettings({ controlPaths: { instructions: "Config\\Style.md", research: "Inbox.md" } }).controlPaths).toEqual({ instructions: "Config/Style.md", research: "Inbox.md" });
  expect(parseSettings({ controlPaths: { instructions: "Same.md", research: "same.md" } }).controlPaths).toEqual(DEFAULT_SETTINGS.controlPaths);
  expect(parseSettings({ controlPaths: { instructions: "../Style.md", research: "Inbox.md" } }).controlPaths).toEqual(DEFAULT_SETTINGS.controlPaths);
});

it("migration preserves exclusions, controls and explicit cloud choices on subsequent loads", () => {
  const raw = { provider: "openrouter", model: "openrouter/free", excludedFolders: ["Private"], excludedTags: ["secret"], apiKey: "synthetic", qa: { multiTurn: true } };
  const snapshot = JSON.stringify(raw);
  const local = parseSettings(raw);
  expect(local.provider).toBe("bonsai");
  expect(local.excludedFolders).toEqual(raw.excludedFolders);
  expect(local.excludedTags).toEqual(raw.excludedTags);
  expect(local.apiKey).toBe("synthetic");
  expect(local.qa.multiTurn).toBe(true);
  expect(JSON.stringify(raw)).toBe(snapshot);
  expect(parseSettings(local)).toEqual(local);
  const cloud = { ...local, provider: "openrouter", endpoint: "https://openrouter.ai/api/v1", model: "openrouter/free" };
  expect(parseSettings(cloud)).toEqual(cloud);
  expect(parseSettings({ ...raw, model: "custom/cloud" }).provider).toBe("openrouter");
});

it("drops retired security paths while preserving configured instructions and inbox", () => {
  const controlPaths = { instructions: "Config/Style.md", research: "Inbox.md", security: "../retired-invalid.md" };
  const parsed = parseSettings({ controlPaths });
  expect(parsed.controlPaths).toEqual({ instructions: "Config/Style.md", research: "Inbox.md" });
  expect(controlPaths.security).toBe("../retired-invalid.md");
});
