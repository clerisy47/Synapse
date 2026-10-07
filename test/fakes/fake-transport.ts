/**
 * Scripted Transport for CI (DESIGN §5.2). No sockets.
 */

import {
  TransportError,
  type Transport,
  type TransportCapabilities,
  type TransportErrorKind,
} from "../../src/core";

export type FakeGetJsonResult =
  | { status: number; body: unknown }
  | { error: { kind: TransportErrorKind; status?: number; message?: string } };

export type FakePostStreamResult =
  | { chunks: unknown[] }
  | { error: { kind: TransportErrorKind; status?: number; message?: string } };

export type FakeTransportCall = {
  method: "getJson" | "postStream";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export class FakeTransport implements Transport {
  readonly capabilities: TransportCapabilities;
  private readonly getQueue: FakeGetJsonResult[] = [];
  private readonly postQueue: FakePostStreamResult[] = [];
  /** Recorded calls for auth/header assertions (M1-T10). */
  readonly calls: FakeTransportCall[] = [];

  constructor(
    capabilities: TransportCapabilities = { streaming: true, abortable: true },
  ) {
    this.capabilities = capabilities;
  }

  enqueueGet(result: FakeGetJsonResult): void {
    this.getQueue.push(result);
  }

  enqueuePostStream(result: FakePostStreamResult): void {
    this.postQueue.push(result);
  }

  async getJson(
    url: string,
    o: {
      timeoutMs: number;
      signal?: AbortSignal;
      headers?: Record<string, string>;
    },
  ): Promise<{ status: number; body: unknown }> {
    throwIfAborted(o.signal);
    const call: FakeTransportCall = { method: "getJson", url };
    if (o.headers !== undefined) {
      call.headers = o.headers;
    }
    this.calls.push(call);
    const next = this.getQueue.shift();
    if (!next) {
      throw new TransportError({
        kind: "protocol",
        message: "FakeTransport: no getJson response scripted",
      });
    }
    if ("error" in next) {
      throw transportErr(next.error);
    }
    throwIfAborted(o.signal);
    return { status: next.status, body: next.body };
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
    throwIfAborted(o.signal);
    const call: FakeTransportCall = { method: "postStream", url, body };
    if (o.headers !== undefined) {
      call.headers = o.headers;
    }
    this.calls.push(call);
    const next = this.postQueue.shift();
    if (!next) {
      throw new TransportError({
        kind: "protocol",
        message: "FakeTransport: no postStream response scripted",
      });
    }
    if ("error" in next) {
      throw transportErr(next.error);
    }
    for (const chunk of next.chunks) {
      throwIfAborted(o.signal);
      yield chunk;
    }
  }
}

function transportErr(e: {
  kind: TransportErrorKind;
  status?: number;
  message?: string;
}): TransportError {
  const init: {
    kind: TransportErrorKind;
    status?: number;
    message?: string;
  } = { kind: e.kind };
  if (e.status !== undefined) {
    init.status = e.status;
  }
  if (e.message !== undefined) {
    init.message = e.message;
  }
  return new TransportError(init);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TransportError({ kind: "aborted", message: "aborted" });
  }
}
