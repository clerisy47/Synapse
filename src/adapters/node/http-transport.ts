/**
 * Node `http`/`https` Transport (DESIGN §5.2, ADR-02).
 * Guarded dynamic import — only this file (+ requestUrl later) may open sockets.
 */

import {
  TransportError,
  type Transport,
  type TransportCapabilities,
} from "../../core";

/** Injected by composition root; EndpointPolicy lands in M1-T12. */
export type EndpointChecker = (url: string) => void;

export type NodeHttpTransportOptions = {
  checkEndpoint?: EndpointChecker;
};

type HttpModules = {
  http: typeof import("http");
  https: typeof import("https");
};

const ERROR_BODY_CLIP = 200;

let modulesPromise: Promise<HttpModules> | undefined;

async function loadHttpModules(): Promise<HttpModules> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([import("http"), import("https")]).then(
      ([http, https]) => ({ http, https }),
    );
  }
  return modulesPromise;
}

export class NodeHttpTransport implements Transport {
  readonly capabilities: TransportCapabilities = {
    streaming: true,
    abortable: true,
  };

  private readonly checkEndpoint: EndpointChecker | undefined;

  constructor(opts: NodeHttpTransportOptions = {}) {
    this.checkEndpoint = opts.checkEndpoint;
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

    const mods = await loadHttpModules();
    const parsed = parseUrl(url);
    const lib = parsed.protocol === "https:" ? mods.https : mods.http;
    const headers = { Accept: "application/json", ...o.headers };

    return new Promise((resolve, reject) => {
      let settled = false;
      let req: import("http").ClientRequest | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const fail = (err: TransportError): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        cleanupAbort();
        try {
          req?.destroy();
        } catch {
          /* ignore */
        }
        reject(err);
      };

      const succeed = (value: { status: number; body: unknown }): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        cleanupAbort();
        resolve(value);
      };

      const onAbort = (): void => {
        fail(new TransportError({ kind: "aborted", message: "aborted" }));
      };

      const cleanupAbort = (): void => {
        o.signal?.removeEventListener("abort", onAbort);
      };

      if (o.signal) {
        if (o.signal.aborted) {
          fail(new TransportError({ kind: "aborted", message: "aborted" }));
          return;
        }
        o.signal.addEventListener("abort", onAbort, { once: true });
      }

      timeout = setTimeout(() => {
        fail(
          new TransportError({
            kind: "timeout_first_byte",
            message: "getJson timed out",
          }),
        );
      }, o.timeoutMs);

      try {
        req = lib.request(
          requestOptions(parsed, "GET", headers),
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer | string) => {
              chunks.push(
                typeof chunk === "string" ? Buffer.from(chunk) : chunk,
              );
            });
            res.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              const status = res.statusCode ?? 0;
              let body: unknown;
              try {
                body = raw.length === 0 ? null : JSON.parse(raw);
              } catch {
                fail(
                  new TransportError({
                    kind: "protocol",
                    status,
                    message: clipBody(raw || "response is not JSON"),
                  }),
                );
                return;
              }
              succeed({ status, body });
            });
            res.on("error", (err) => {
              fail(mapNodeError(err));
            });
          },
        );
      } catch (err) {
        fail(mapNodeError(err));
        return;
      }

      req.on("error", (err) => {
        fail(mapNodeError(err));
      });
      req.end();
    });
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

    const mods = await loadHttpModules();
    const parsed = parseUrl(url);
    const lib = parsed.protocol === "https:" ? mods.https : mods.http;
    const payload = JSON.stringify(body);

    const queue: unknown[] = [];
    let waiting: ((v: IteratorResult<unknown>) => void) | undefined;
    let done = false;
    let streamError: TransportError | undefined;
    let gotFirstByte = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let req: import("http").ClientRequest | undefined;
    let res: import("http").IncomingMessage | undefined;
    let lineBuf = "";

    const settleWait = (result: IteratorResult<unknown>): void => {
      if (!waiting) return;
      const w = waiting;
      waiting = undefined;
      w(result);
    };

    const fail = (err: TransportError): void => {
      if (done) return;
      done = true;
      streamError = err;
      clearTimers();
      destroySocket();
      cleanupAbort();
      settleWait({ done: true, value: undefined });
    };

    const push = (value: unknown): void => {
      if (done) return;
      if (waiting) {
        settleWait({ done: false, value });
      } else {
        queue.push(value);
      }
    };

    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimers();
      cleanupAbort();
      settleWait({ done: true, value: undefined });
    };

    const clearTimers = (): void => {
      if (firstByteTimer !== undefined) clearTimeout(firstByteTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      firstByteTimer = undefined;
      idleTimer = undefined;
    };

    const armIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(
          new TransportError({
            kind: "timeout_idle",
            message: "idle timeout",
          }),
        );
      }, o.idleTimeoutMs);
    };

    const destroySocket = (): void => {
      try {
        res?.destroy();
      } catch {
        /* ignore */
      }
      try {
        req?.destroy();
      } catch {
        /* ignore */
      }
    };

    const onAbort = (): void => {
      fail(new TransportError({ kind: "aborted", message: "aborted" }));
    };

    const cleanupAbort = (): void => {
      o.signal.removeEventListener("abort", onAbort);
    };

    o.signal.addEventListener("abort", onAbort, { once: true });

    firstByteTimer = setTimeout(() => {
      if (!gotFirstByte) {
        fail(
          new TransportError({
            kind: "timeout_first_byte",
            message: "first-byte timeout",
          }),
        );
      }
    }, o.firstByteTimeoutMs);

    const headers = {
      Accept: "application/x-ndjson, application/json",
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(payload)),
      ...o.headers,
    };

    try {
      req = lib.request(
        requestOptions(parsed, "POST", headers),
        (incoming) => {
          res = incoming;
          const status = incoming.statusCode ?? 0;

          const onData = (chunk: Buffer | string): void => {
            if (!gotFirstByte) {
              gotFirstByte = true;
              if (firstByteTimer !== undefined) clearTimeout(firstByteTimer);
              firstByteTimer = undefined;
            }
            armIdle();

            const text =
              typeof chunk === "string" ? chunk : chunk.toString("utf8");
            lineBuf += text;
            const parts = lineBuf.split("\n");
            lineBuf = parts.pop() ?? "";
            for (const line of parts) {
              const trimmed = line.trim();
              if (trimmed.length === 0) continue;
              try {
                push(JSON.parse(trimmed));
              } catch {
                fail(
                  new TransportError({
                    kind: "protocol",
                    message: "NDJSON line is not JSON",
                  }),
                );
                return;
              }
            }
          };

          if (status >= 400) {
            const errChunks: Buffer[] = [];
            incoming.on("data", (c: Buffer | string) => {
              errChunks.push(typeof c === "string" ? Buffer.from(c) : c);
            });
            incoming.on("end", () => {
              fail(
                new TransportError({
                  kind: "http",
                  status,
                  message: clipBody(Buffer.concat(errChunks).toString("utf8")),
                }),
              );
            });
            incoming.on("error", (err) => fail(mapNodeError(err)));
            return;
          }

          incoming.on("data", onData);
          incoming.on("end", () => {
            if (lineBuf.trim().length > 0) {
              try {
                push(JSON.parse(lineBuf.trim()));
              } catch {
                fail(
                  new TransportError({
                    kind: "protocol",
                    message: "trailing NDJSON is not JSON",
                  }),
                );
                return;
              }
            }
            finish();
          });
          incoming.on("error", (err) => fail(mapNodeError(err)));
        },
      );
    } catch (err) {
      fail(mapNodeError(err));
    }

    if (req) {
      req.on("error", (err) => fail(mapNodeError(err)));
      req.write(payload);
      req.end();
    }

    const throwIfFailed = (): void => {
      if (streamError !== undefined) {
        throw streamError;
      }
    };

    try {
      while (true) {
        throwIfFailed();
        if (queue.length > 0) {
          yield queue.shift();
          continue;
        }
        if (done) {
          throwIfFailed();
          return;
        }
        const next = await new Promise<IteratorResult<unknown>>((resolve) => {
          waiting = resolve;
        });
        throwIfFailed();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      clearTimers();
      destroySocket();
      cleanupAbort();
      done = true;
    }
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

type ParsedUrl = {
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
};

function parseUrl(url: string): ParsedUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TransportError({ kind: "protocol", message: "invalid URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TransportError({
      kind: "protocol",
      message: `unsupported protocol ${parsed.protocol}`,
    });
  }
  const out: ParsedUrl = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    path: `${parsed.pathname}${parsed.search}`,
  };
  if (parsed.port.length > 0) {
    const port = Number(parsed.port);
    if (Number.isFinite(port)) out.port = port;
  }
  return out;
}

function requestOptions(
  parsed: ParsedUrl,
  method: string,
  headers: Record<string, string>,
): import("http").RequestOptions {
  const opts: import("http").RequestOptions = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    path: parsed.path,
    method,
    headers,
  };
  if (parsed.port !== undefined) opts.port = parsed.port;
  return opts;
}

function mapNodeError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  if (!(err instanceof Error)) {
    return new TransportError({ kind: "protocol", message: "request failed" });
  }
  const code =
    "code" in err && typeof err.code === "string" ? err.code : "";
  const message = err.message.slice(0, ERROR_BODY_CLIP);

  if (code === "ECONNREFUSED" || code === "ECONNRESET") {
    return new TransportError({ kind: "refused", message });
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new TransportError({ kind: "dns", message });
  }
  if (code === "ABORT_ERR" || message.includes("aborted")) {
    return new TransportError({ kind: "aborted", message: "aborted" });
  }
  return new TransportError({ kind: "protocol", message });
}
