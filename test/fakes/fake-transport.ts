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

export class FakeTransport implements Transport {
  readonly capabilities: TransportCapabilities;
  private readonly getQueue: FakeGetJsonResult[] = [];
  private readonly postQueue: FakePostStreamResult[] = [];

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
    _url: string,
    o: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ status: number; body: unknown }> {
    throwIfAborted(o.signal);
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
    _url: string,
    _body: unknown,
    o: {
      signal: AbortSignal;
      firstByteTimeoutMs: number;
      idleTimeoutMs: number;
    },
  ): AsyncIterable<unknown> {
    throwIfAborted(o.signal);
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
