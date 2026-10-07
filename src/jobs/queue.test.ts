/**
 * JobQueue rules (DESIGN §5.4) against FakeClock.
 */

import { describe, expect, it } from "vitest";

import { err, ok, synapseError, type Result } from "../core";
import { FakeClock } from "../../test/fakes";
import { abortReasonOf, createJobQueue, PRIORITY, type JobContext } from "./index";

function defer<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T | PromiseLike<T>) => void;
} {
  let resolve!: (v: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("PRIORITY", () => {
  it("orders qa/health before contradiction before resurface", () => {
    expect(PRIORITY.qa).toBeLessThan(PRIORITY.contradiction);
    expect(PRIORITY.health).toBe(PRIORITY.qa);
    expect(PRIORITY.contradiction).toBeLessThan(PRIORITY.resurface);
  });
});

describe("createJobQueue", () => {
  it("runs at most one job and FIFO within equal priority", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const order: string[] = [];
    const gate = defer();

    const a = q.submit({
      kind: "health",
      label: "A",
      async run() {
        order.push("a-start");
        await gate.promise;
        order.push("a-end");
        return ok("a");
      },
    });
    const b = q.submit({
      kind: "health",
      label: "B",
      async run() {
        order.push("b");
        return ok("b");
      },
    });

    await flushMicrotasks();
    expect(order).toEqual(["a-start"]);
    expect(q.status.get().model).toBe("running");
    expect(q.status.get().queued).toBe(1);

    gate.resolve();
    await expect(a.result).resolves.toEqual(ok("a"));
    await expect(b.result).resolves.toEqual(ok("b"));
    expect(order).toEqual(["a-start", "a-end", "b"]);
    expect(q.status.get().model).toBe("idle");
    q.dispose();
  });

  it("preempts with abort+resume and memoizes completed steps", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const stepCounts = { snap: 0, pass: 0 };
    const reasons: Array<string | undefined> = [];
    const bgStarted = defer();
    let attempts = 0;

    const bg = q.submit({
      kind: "contradiction",
      label: "Background",
      async run(ctx: JobContext) {
        attempts++;
        await ctx.step("snap", async () => {
          stepCounts.snap++;
          return "snapshot";
        });
        if (attempts === 1) {
          bgStarted.resolve();
          try {
            await clock.sleep(5_000, ctx.signal);
          } catch (e) {
            reasons.push(abortReasonOf(ctx.signal)?.kind);
            throw e instanceof Error ? e : new Error("preempted");
          }
        }
        await ctx.step("pass", async () => {
          stepCounts.pass++;
          return "pass";
        });
        return ok("bg");
      },
    });

    await bgStarted.promise;
    expect(stepCounts.snap).toBe(1);
    expect(q.status.get().model).toBe("running");

    const qa = q.submit({
      kind: "qa",
      label: "Question",
      async run() {
        expect(bg.state.get()).toBe("paused");
        return ok("qa");
      },
    });

    await expect(qa.result).resolves.toEqual(ok("qa"));
    await expect(bg.result).resolves.toEqual(ok("bg"));

    expect(reasons).toContain("preempted");
    expect(attempts).toBe(2);
    expect(stepCounts.snap).toBe(1);
    expect(stepCounts.pass).toBe(1);
    expect(bg.state.get()).toBe("done");
    expect(q.status.get().model).toBe("idle");
    q.dispose();
  });

  it("replaces queued or running jobs with the same dedupeKey", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const hold = defer();
    let runs = 0;

    const first = q.submit({
      kind: "contradiction",
      label: "First",
      dedupeKey: "contradiction:note",
      async run() {
        runs++;
        await hold.promise;
        return ok(1);
      },
    });

    await flushMicrotasks();
    const second = q.submit({
      kind: "contradiction",
      label: "Second",
      dedupeKey: "contradiction:note",
      async run() {
        runs++;
        return ok(2);
      },
    });

    await expect(first.result).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    hold.resolve();
    await expect(second.result).resolves.toEqual(ok(2));
    expect(runs).toBe(2); // first started, then second after cancel settle
    q.dispose();
  });

  it("non-abortable cancel detaches result but holds the lane", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock, abortable: false });
    const release = defer();
    const secondStarted = defer<boolean>();

    const first = q.submit({
      kind: "health",
      label: "Sticky",
      async run() {
        // Ignores signal — simulates non-abortable HTTP still in flight.
        await release.promise;
        return ok("done");
      },
    });

    await flushMicrotasks();
    first.cancel();
    await expect(first.result).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    expect(first.state.get()).toBe("cancelled");

    const second = q.submit({
      kind: "health",
      label: "Next",
      async run() {
        secondStarted.resolve(true);
        return ok("next");
      },
    });

    await flushMicrotasks();
    expect(secondStarted.promise).toBeInstanceOf(Promise);
    // Second must not have started yet.
    let started = false;
    void secondStarted.promise.then(() => {
      started = true;
    });
    await flushMicrotasks();
    expect(started).toBe(false);
    expect(q.status.get().queued).toBe(1);

    release.resolve();
    await expect(second.result).resolves.toEqual(ok("next"));
    expect(started).toBe(true);
    q.dispose();
  });

  it("activeMs excludes paused time across preemption", async () => {
    const clock = new FakeClock(10_000);
    const q = createJobQueue({ clock });
    const inSleep = defer();
    let measured = -1;
    let attempts = 0;

    const bg = q.submit({
      kind: "contradiction",
      label: "Timed",
      async run(ctx) {
        attempts++;
        await ctx.step("prep", async () => "ok");
        if (attempts === 1) {
          inSleep.resolve();
          try {
            await clock.sleep(10_000, ctx.signal);
          } catch (e) {
            throw e instanceof Error ? e : new Error("preempted");
          }
        }
        measured = ctx.activeMs();
        return ok(measured);
      },
    });

    await inSleep.promise;
    clock.advance(2_000); // 2s active before preempt

    const qa = q.submit({
      kind: "qa",
      label: "Interrupt",
      async run() {
        clock.advance(50_000); // wall time while bg is paused — must not count
        return ok("qa");
      },
    });

    await qa.result;
    await bg.result;
    expect(measured).toBeGreaterThanOrEqual(2_000);
    expect(measured).toBeLessThan(10_000);
    q.dispose();
  });

  it("cancel propagates AbortSignal and resolve CANCELLED", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const started = defer();
    let sawCancel = false;

    const handle = q.submit({
      kind: "qa",
      label: "Cancellable",
      async run(ctx) {
        started.resolve();
        try {
          await clock.sleep(5_000, ctx.signal);
        } catch {
          sawCancel = abortReasonOf(ctx.signal)?.kind === "cancelled";
          return cancelled();
        }
        return ok("nope");
      },
    });

    await started.promise;
    handle.cancel();
    const result = await handle.result;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CANCELLED");
    }
    expect(sawCancel).toBe(true);
    expect(handle.state.get()).toBe("cancelled");
    q.dispose();
  });

  it("cancelAll and dispose leave the queue idle", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const hold = defer();

    const a = q.submit({
      kind: "resurface",
      label: "A",
      async run() {
        await hold.promise;
        return ok(1);
      },
    });
    const b = q.submit({
      kind: "resurface",
      label: "B",
      async run() {
        return ok(2);
      },
    });

    await flushMicrotasks();
    q.cancelAll();
    await expect(a.result).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    await expect(b.result).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
    hold.resolve();
    await flushMicrotasks();

    q.dispose();
    expect(q.status.get().model).toBe("idle");
    expect(q.status.get().queued).toBe(0);

    const after = q.submit({
      kind: "qa",
      label: "After dispose",
      async run() {
        return ok("x");
      },
    });
    await expect(after.result).resolves.toMatchObject({
      ok: false,
      error: { code: "CANCELLED" },
    });
  });

  it("maps thrown errors to INTERNAL and status error", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });

    const handle = q.submit({
      kind: "health",
      label: "Boom",
      async run() {
        throw new Error("boom");
      },
    });

    const result = await handle.result;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
    }
    expect(handle.state.get()).toBe("failed");
    expect(q.status.get().model).toBe("error");
    expect(q.status.get().lastError?.code).toBe("INTERNAL");
    q.dispose();
  });

  it("surfaces Result err from run as failed without throwing", async () => {
    const clock = new FakeClock(1_000);
    const q = createJobQueue({ clock });
    const failure = synapseError({
      code: "MODEL_TIMEOUT",
      message: "timed out",
    });

    const handle = q.submit({
      kind: "qa",
      label: "Timeout",
      async run(): Promise<Result<string>> {
        return err(failure);
      },
    });

    await expect(handle.result).resolves.toEqual(err(failure));
    expect(handle.state.get()).toBe("failed");
    expect(q.status.get().model).toBe("error");
    q.dispose();
  });
});

function cancelled(): Result<string> {
  return err(synapseError({ code: "CANCELLED", message: "Job cancelled" }));
}
