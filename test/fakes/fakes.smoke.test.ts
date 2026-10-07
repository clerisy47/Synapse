/**
 * M1-T08: smoke that each fake implements its port and runs under vitest
 * without Obsidian / network.
 */

import { describe, expect, it } from "vitest";

import { TransportError, type Clock, type Logger, type StoragePort, type Transport } from "../../src/core";
import { healthOutputSchema } from "../../src/llm";
import {
  FakeClock,
  FakeTransport,
  MemoryStorage,
  RingBufferLogger,
  ScriptedModel,
  type ModelPort,
} from "./index";

describe("test/fakes smoke (M1-T08)", () => {
  it("exports FakeClock as Clock", async () => {
    const clock: Clock = new FakeClock(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);
    expect(clock.mono()).toBe(1_700_000_000_000);
    expect(clock.todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const p = clock.sleep(100);
    (clock as FakeClock).advance(100);
    await p;
    await clock.yieldNow();
  });

  it("exports FakeTransport as Transport", async () => {
    const transport: Transport = new FakeTransport();
    expect(transport.capabilities.streaming).toBe(true);
    expect(transport.capabilities.abortable).toBe(true);

    (transport as FakeTransport).enqueueGet({ status: 200, body: { ok: true } });
    const get = await transport.getJson("https://example.test/", { timeoutMs: 1000 });
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ ok: true });

    (transport as FakeTransport).enqueuePostStream({
      chunks: [{ a: 1 }, { a: 2 }],
    });
    const chunks: unknown[] = [];
    for await (const c of transport.postStream(
      "https://example.test/stream",
      {},
      { signal: new AbortController().signal, firstByteTimeoutMs: 1000, idleTimeoutMs: 1000 },
    )) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ a: 1 }, { a: 2 }]);

    (transport as FakeTransport).enqueueGet({
      error: { kind: "refused", message: "down" },
    });
    await expect(
      transport.getJson("https://example.test/", { timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it("exports MemoryStorage as StoragePort", async () => {
    const storage: StoragePort = new MemoryStorage();
    expect(await storage.loadData()).toBeNull();
    await storage.saveData({ v: 1 });
    expect(await storage.loadData()).toEqual({ v: 1 });

    await storage.writeJson("cache/x.json", { n: 2 });
    expect(await storage.readJson("cache/x.json")).toEqual({ n: 2 });
    expect(await storage.list("cache")).toEqual(["x.json"]);
    await storage.removeDir("cache");
    expect(await storage.readJson("cache/x.json")).toBeNull();

    let fired = 0;
    const dispose = storage.onExternalDataChange(() => {
      fired += 1;
    });
    (storage as MemoryStorage).emitExternalDataChange();
    expect(fired).toBe(1);
    dispose();
  });

  it("exports ScriptedModel as ModelPort", async () => {
    const model: ModelPort = new ScriptedModel();
    (model as ScriptedModel).enqueue({ kind: "health", value: { ok: true } });
    const result = await model.generate(
      {
        kind: "health",
        instructions: "ping",
        input: "",
        schema: healthOutputSchema,
        numPredict: 16,
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ ok: true });
      expect(result.value.attempts).toBe(1);
    }
  });

  it("exports RingBufferLogger as Logger", () => {
    const logger: Logger = new RingBufferLogger({ capacity: 2, now: () => 42 });
    logger.info("a", { n: 1 });
    const child = logger.child("jobs");
    child.warn("b");
    const events = (logger as RingBufferLogger).events();
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe("a");
    expect(events[1]?.scope).toBe("jobs");
    expect(events[1]?.event).toBe("b");

    expect(() =>
      logger.info("dump", { text: "x".repeat(81) }),
    ).toThrow(/exceeds 80 chars/);
  });
});
