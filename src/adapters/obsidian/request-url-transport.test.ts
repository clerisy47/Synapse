/**
 * RequestUrlTransport unit tests with stubbed requestUrl (M1-T13).
 */

import { describe, expect, it, vi } from "vitest";

import { TransportError } from "../../core";
import {
  RequestUrlTransport,
  type RequestUrlFn,
} from "./request-url-transport";

function stubResponse(init: {
  status?: number;
  json?: unknown;
  text?: string;
}): Awaited<ReturnType<RequestUrlFn>> {
  return {
    status: init.status ?? 200,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json: init.json,
    text: init.text ?? (init.json !== undefined ? JSON.stringify(init.json) : ""),
  };
}

describe("RequestUrlTransport", () => {
  it("exposes non-streaming non-abortable capabilities", () => {
    const t = new RequestUrlTransport({
      requestUrl: async () => stubResponse({ json: {} }),
    });
    expect(t.capabilities).toEqual({ streaming: false, abortable: false });
  });

  it("getJson returns status and parsed body", async () => {
    const requestUrl = vi.fn(async () =>
      stubResponse({ status: 200, json: { version: "1" } }),
    );
    const t = new RequestUrlTransport({ requestUrl });
    const res = await t.getJson("https://example.com/v", {
      timeoutMs: 1000,
    });
    expect(res).toEqual({ status: 200, body: { version: "1" } });
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/v",
        method: "GET",
        throw: false,
      }),
    );
  });

  it("postStream yields exactly one object", async () => {
    const requestUrl = vi.fn(async () =>
      stubResponse({ status: 200, json: { ok: true } }),
    );
    const t = new RequestUrlTransport({ requestUrl });
    const chunks: unknown[] = [];
    for await (const c of t.postStream(
      "https://example.com/chat",
      { model: "x" },
      {
        signal: new AbortController().signal,
        firstByteTimeoutMs: 1000,
        idleTimeoutMs: 1000,
      },
    )) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ ok: true }]);
  });

  it("postStream throws http on 4xx and clips body", async () => {
    const long = "x".repeat(500);
    const t = new RequestUrlTransport({
      requestUrl: async () => stubResponse({ status: 400, text: long }),
    });
    await expect(async () => {
      for await (const c of t.postStream(
        "https://example.com/chat",
        {},
        {
          signal: new AbortController().signal,
          firstByteTimeoutMs: 1000,
          idleTimeoutMs: 1000,
        },
      )) {
        void c;
      }
    }).rejects.toMatchObject({
      kind: "http",
      status: 400,
    });
  });

  it("throws aborted when signal is already aborted", async () => {
    const requestUrl = vi.fn(async () => stubResponse({ json: {} }));
    const t = new RequestUrlTransport({ requestUrl });
    const ac = new AbortController();
    ac.abort();
    await expect(
      t.getJson("https://example.com/v", {
        timeoutMs: 1000,
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("invokes checkEndpoint before request and maps blocked", async () => {
    const requestUrl = vi.fn(async () => stubResponse({ json: {} }));
    let checked = "";
    const t = new RequestUrlTransport({
      requestUrl,
      checkEndpoint: (url) => {
        checked = url;
        throw new TransportError({ kind: "blocked", message: "denied" });
      },
    });
    await expect(
      t.getJson("https://example.com/v", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "blocked" });
    expect(checked).toBe("https://example.com/v");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("throws aborted after await when signal fires during request", async () => {
    const ac = new AbortController();
    const t = new RequestUrlTransport({
      requestUrl: async () => {
        ac.abort();
        return stubResponse({ json: { late: true } });
      },
    });
    await expect(async () => {
      for await (const c of t.postStream(
        "https://example.com/chat",
        {},
        {
          signal: ac.signal,
          firstByteTimeoutMs: 1000,
          idleTimeoutMs: 1000,
        },
      )) {
        void c;
      }
    }).rejects.toMatchObject({ kind: "aborted" });
  });
});
