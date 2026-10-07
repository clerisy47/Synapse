/**
 * Obsidian requestUrl Transport (DESIGN §5.2, ADR-02).
 * Degraded / health path: no streaming, no abort of in-flight requests.
 * Only this file (+ node http-transport) may open network.
 */

import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

import {
  TransportError,
  type Transport,
  type TransportCapabilities,
} from "../../core";

/** Injected by composition root; same shape as Node EndpointChecker. */
export type EndpointChecker = (url: string) => void;

/** Injectable for unit tests (defaults to Obsidian requestUrl). */
export type RequestUrlFn = (
  request: RequestUrlParam | string,
) => Promise<RequestUrlResponse>;

export type RequestUrlTransportOptions = {
  checkEndpoint?: EndpointChecker;
  requestUrl?: RequestUrlFn;
};

const ERROR_BODY_CLIP = 200;

let defaultRequestUrlPromise: Promise<RequestUrlFn> | undefined;

/** Guarded dynamic import — keeps `requestUrl(` in this allowlisted file. */
async function loadDefaultRequestUrl(): Promise<RequestUrlFn> {
  if (!defaultRequestUrlPromise) {
    defaultRequestUrlPromise = import("obsidian").then((mod) => {
      const fn = mod.requestUrl.bind(mod) as RequestUrlFn;
      return fn;
    });
  }
  return defaultRequestUrlPromise;
}

export class RequestUrlTransport implements Transport {
  readonly capabilities: TransportCapabilities = {
    streaming: false,
    abortable: false,
  };

  private readonly checkEndpoint: EndpointChecker | undefined;
  private readonly injectedRequestUrl: RequestUrlFn | undefined;

  constructor(opts: RequestUrlTransportOptions = {}) {
    this.checkEndpoint = opts.checkEndpoint;
    this.injectedRequestUrl = opts.requestUrl;
  }

  async getJson(
    url: string,
    o: {
      timeoutMs: number;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; body: unknown }> {
    this.assertEndpoint(url);
    throwIfAborted(o.signal);
    void o.timeoutMs; // requestUrl has no timeout API; caller budgets via jobs

    try {
      const requestUrl = await this.resolveRequestUrl();
      const res = await requestUrl({
        url,
        method: "GET",
        headers: { Accept: "application/json", ...o.headers },
        throw: false,
      });
      throwIfAborted(o.signal);
      return { status: res.status, body: parseBody(res) };
    } catch (err) {
      throw mapRequestError(err);
    }
  }

  async *postStream(
    url: string,
    body: unknown,
    o: {
      signal: AbortSignal;
      firstByteTimeoutMs: number;
      idleTimeoutMs: number;
      headers?: Record<string, string>;
    },
  ): AsyncIterable<unknown> {
    this.assertEndpoint(url);
    throwIfAborted(o.signal);
    void o.firstByteTimeoutMs;
    void o.idleTimeoutMs;

    let res: RequestUrlResponse;
    try {
      const requestUrl = await this.resolveRequestUrl();
      res = await requestUrl({
        url,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...o.headers,
        },
        body: JSON.stringify(body),
        throw: false,
      });
    } catch (err) {
      throw mapRequestError(err);
    }

    // Detach: cannot cancel in-flight requestUrl; honor abort after await.
    throwIfAborted(o.signal);

    if (res.status >= 400) {
      throw new TransportError({
        kind: "http",
        status: res.status,
        message: clipBody(res.text || `HTTP ${res.status}`),
      });
    }

    yield parseBody(res);
  }

  private async resolveRequestUrl(): Promise<RequestUrlFn> {
    if (this.injectedRequestUrl) {
      return this.injectedRequestUrl;
    }
    return loadDefaultRequestUrl();
  }

  private assertEndpoint(url: string): void {
    if (this.checkEndpoint) {
      this.checkEndpoint(url);
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TransportError({ kind: "aborted", message: "aborted" });
  }
}

function clipBody(raw: string): string {
  if (raw.length <= ERROR_BODY_CLIP) return raw;
  return raw.slice(0, ERROR_BODY_CLIP);
}

function parseBody(res: RequestUrlResponse): unknown {
  if (res.json !== undefined) {
    return res.json;
  }
  const text = res.text?.trim() ?? "";
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TransportError({
      kind: "protocol",
      message: clipBody(text || "response is not JSON"),
    });
  }
}

function mapRequestError(err: unknown): TransportError {
  if (err instanceof TransportError) {
    return err;
  }
  if (!(err instanceof Error)) {
    return new TransportError({ kind: "protocol", message: "request failed" });
  }
  const message = err.message.slice(0, ERROR_BODY_CLIP);
  const lower = message.toLowerCase();
  if (lower.includes("refus") || lower.includes("econnrefused")) {
    return new TransportError({ kind: "refused", message });
  }
  if (lower.includes("enotfound") || lower.includes("dns")) {
    return new TransportError({ kind: "dns", message });
  }
  if (lower.includes("abort")) {
    return new TransportError({ kind: "aborted", message: "aborted" });
  }
  return new TransportError({ kind: "protocol", message });
}
