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
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from "../constants";

describe("DEFAULT_SETTINGS", () => {
  it("uses Phase A OpenRouter endpoint and pinned free model", () => {
    expect(DEFAULT_SETTINGS.endpoint).toBe(DEFAULT_OPENROUTER_BASE_URL);
    expect(DEFAULT_SETTINGS.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(DEFAULT_SETTINGS.provider).toBe("openrouter");
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
      numCtx: 99999,
      qa: { maxHops: 1, wallClockSec: 500 },
      contradiction: { onIdle: { debounceSec: 10 } },
      resurface: { staleDays: 3 },
    });

    expect(parsed.numCtx).toBe(SETTINGS_BOUNDS.numCtx.max);
    expect(parsed.qa.maxHops).toBe(SETTINGS_BOUNDS.qaMaxHops.min);
    expect(parsed.qa.wallClockSec).toBe(SETTINGS_BOUNDS.qaWallClockSec.max);
    expect(parsed.contradiction.onIdle.debounceSec).toBe(
      SETTINGS_BOUNDS.contradictionDebounceSec.min,
    );
    expect(parsed.resurface.staleDays).toBe(SETTINGS_BOUNDS.resurfaceStaleDays.min);
  });

  it("accepts valid http(s) endpoints and rejects others", () => {
    expect(parseSettings({ endpoint: "https://openrouter.ai/api/v1" }).endpoint).toBe(
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
    expect(parsed.contradiction.onIdle.enabled).toBe(true);
    expect(parsed.contradiction.onIdle.debounceSec).toBe(
      DEFAULT_SETTINGS.contradiction.onIdle.debounceSec,
    );
    expect(parsed.qa).toEqual(DEFAULT_SETTINGS.qa);
    expect(parsed.resurface).toEqual(DEFAULT_SETTINGS.resurface);
  });

  it("never throws on hostile blobs", () => {
    expect(() => parseSettings({ qa: null, contradiction: [], resurface: 0 })).not.toThrow();
  });
});

describe("migrateSettings", () => {
  it("is an identity stub", () => {
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
