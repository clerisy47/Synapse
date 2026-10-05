import { describe, expect, it, vi } from "vitest";
import { TransportError, createObservable } from "./index";

describe("createObservable", () => {
  it("get returns the current value", () => {
    const o = createObservable(1);
    expect(o.get()).toBe(1);
    o.set(2);
    expect(o.get()).toBe(2);
  });

  it("notifies subscribers on set and unsubscribe stops delivery", () => {
    const o = createObservable("a");
    const cb = vi.fn();
    const dispose = o.subscribe(cb);
    o.set("b");
    expect(cb).toHaveBeenCalledWith("b");
    dispose();
    o.set("c");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("TransportError", () => {
  it("carries kind and optional status", () => {
    const e = new TransportError({ kind: "http", status: 429, message: "rate limited" });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("TransportError");
    expect(e.kind).toBe("http");
    expect(e.status).toBe(429);
    expect(e.message).toBe("rate limited");
  });
});
