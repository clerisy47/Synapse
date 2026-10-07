/**
 * OpenRouter HealthChecker (DESIGN §5.4 / §5.6.1, AC-M1.1–1.3).
 * quick uses GET /key; full adds one production-shaped schema call.
 */

import {
  NUM_PREDICT,
  TIMEOUT_GET_MS,
} from "../constants";
import {
  createObservable,
  synapseError,
  type Clock,
  type MutableObservable,
  type Observable,
  type SynapseError,
  type Transport,
} from "../core";
import {
  authHeaders,
  mapTransportFailure,
  type ModelPort,
  type OpenRouterClient,
} from "./client";
import { joinEndpoint } from "./request";
import { healthOutputSchema } from "./schemas";

export type HealthReport = {
  checkedAt: number;
  fingerprint: string;
  server: { ok: boolean; version?: string; error?: SynapseError };
  model: { ok: boolean; digest?: string; recommended?: boolean; error?: SynapseError };
  structured:
    | "skipped"
    | {
        ok: boolean;
        formatIgnored?: boolean;
        thinkingSeen?: boolean;
        error?: SynapseError;
      };
  advisories: Array<
    | "digest_differs_from_evaluated"
    | "model_spills_to_cpu"
    | "non_loopback_endpoint"
  >;
};

export type AiAvailability =
  | { state: "unknown" }
  | { state: "ready"; report: HealthReport }
  | { state: "disabled"; report: HealthReport };

export interface HealthChecker {
  quick(): Promise<HealthReport>;
  full(signal: AbortSignal): Promise<HealthReport>;
  readonly availability: Observable<AiAvailability>;
}

export type OpenRouterHealthCheckerOptions = {
  transport: Transport;
  model: ModelPort;
  endpoint: string;
  modelId: string;
  apiKey: string | null;
  numCtx: number;
  clock: Clock;
  getTimeoutMs?: number;
};

export class OpenRouterHealthChecker implements HealthChecker {
  private readonly transport: Transport;
  private readonly model: ModelPort;
  private readonly endpoint: string;
  private readonly modelId: string;
  private readonly apiKey: string | null;
  private readonly numCtx: number;
  private readonly clock: Clock;
  private readonly getTimeoutMs: number;
  private readonly availabilityState: MutableObservable<AiAvailability>;

  readonly availability: Observable<AiAvailability>;

  constructor(opts: OpenRouterHealthCheckerOptions) {
    this.transport = opts.transport;
    this.model = opts.model;
    this.endpoint = opts.endpoint;
    this.modelId = opts.modelId;
    this.apiKey = opts.apiKey;
    this.numCtx = opts.numCtx;
    this.clock = opts.clock;
    this.getTimeoutMs = opts.getTimeoutMs ?? TIMEOUT_GET_MS;
    this.availabilityState = createObservable<AiAvailability>({
      state: "unknown",
    });
    this.availability = this.availabilityState;
  }

  async quick(): Promise<HealthReport> {
    const report = await this.probeKey("skipped");
    this.publish(report);
    return report;
  }

  async full(signal: AbortSignal): Promise<HealthReport> {
    const base = await this.probeKey("skipped");
    if (!base.server.ok) {
      this.publish(base);
      return base;
    }

    if (signal.aborted) {
      const cancelled = withStructured(base, {
        ok: false,
        error: synapseError({
          code: "CANCELLED",
          message: "health check cancelled",
        }),
      });
      this.publish(cancelled);
      return cancelled;
    }

    const generated = await this.model.generate(
      {
        kind: "health",
        instructions:
          'Return a JSON object with a single boolean field "ok" set to true.',
        input: "{}",
        schema: healthOutputSchema,
        numPredict: NUM_PREDICT.health,
      },
      signal,
    );

    if (!generated.ok) {
      const structured: Exclude<HealthReport["structured"], "skipped"> = {
        ok: false,
        error: generated.error,
      };
      if (generated.error.code === "FORMAT_IGNORED") {
        structured.formatIgnored = true;
      }
      const report = withStructured(base, structured);
      report.model = {
        ok: false,
        error: generated.error,
      };
      this.publish(report);
      return report;
    }

    const report: HealthReport = {
      ...base,
      checkedAt: this.clock.now(),
      model: { ok: true },
      structured: { ok: true },
    };
    this.publish(report);
    return report;
  }

  private async probeKey(
    structured: HealthReport["structured"],
  ): Promise<HealthReport> {
    const checkedAt = this.clock.now();
    const fingerprint = `${this.endpoint}|${this.modelId}|${this.numCtx}|openrouter`;
    const key = this.apiKey?.trim() ?? "";

    if (key.length === 0) {
      const error = synapseError({
        code: "MODEL_HTTP_ERROR",
        message: "OpenRouter API key is missing",
        remediation: "set_api_key",
      });
      return {
        checkedAt,
        fingerprint,
        server: { ok: false, error },
        model: { ok: false, error },
        structured,
        advisories: [],
      };
    }

    try {
      const res = await this.transport.getJson(
        joinEndpoint(this.endpoint, "/key"),
        {
          timeoutMs: this.getTimeoutMs,
          headers: authHeaders(key),
        },
      );

      if (res.status === 401 || res.status === 403) {
        const error = synapseError({
          code: "MODEL_HTTP_ERROR",
          message: "OpenRouter authentication failed",
          remediation: "auth_failed",
          detail: { status: res.status },
        });
        return {
          checkedAt,
          fingerprint,
          server: { ok: false, error },
          model: { ok: false, error },
          structured,
          advisories: [],
        };
      }

      if (res.status === 429) {
        const error = synapseError({
          code: "MODEL_HTTP_ERROR",
          message: "OpenRouter rate limit exceeded",
          remediation: "rate_limited",
          detail: { status: 429 },
        });
        return {
          checkedAt,
          fingerprint,
          server: { ok: false, error },
          model: { ok: false, error },
          structured,
          advisories: [],
        };
      }

      if (res.status < 200 || res.status >= 300) {
        const error = synapseError({
          code: "MODEL_HTTP_ERROR",
          message: `OpenRouter /key HTTP ${res.status}`,
          remediation: "model_http_error",
          detail: { status: res.status },
        });
        return {
          checkedAt,
          fingerprint,
          server: { ok: false, error },
          model: { ok: false, error },
          structured,
          advisories: [],
        };
      }

      const version = extractKeyLabel(res.body);
      return {
        checkedAt,
        fingerprint,
        server: version !== undefined ? { ok: true, version } : { ok: true },
        model: { ok: true },
        structured,
        advisories: [],
      };
    } catch (cause) {
      const error = mapTransportFailure(cause);
      return {
        checkedAt,
        fingerprint,
        server: { ok: false, error },
        model: { ok: false, error },
        structured,
        advisories: [],
      };
    }
  }

  private publish(report: HealthReport): void {
    if (!report.server.ok) {
      this.availabilityState.set({ state: "disabled", report });
      return;
    }
    if (report.structured === "skipped") {
      this.availabilityState.set({ state: "unknown" });
      return;
    }
    if (report.structured.ok && report.model.ok) {
      this.availabilityState.set({ state: "ready", report });
      return;
    }
    this.availabilityState.set({ state: "disabled", report });
  }
}

/** Convenience: wire health checker to an OpenRouterClient with matching config. */
export function createOpenRouterHealthChecker(
  client: OpenRouterClient,
  opts: Omit<OpenRouterHealthCheckerOptions, "model"> & {
    model?: ModelPort;
  },
): OpenRouterHealthChecker {
  return new OpenRouterHealthChecker({
    ...opts,
    model: opts.model ?? client,
  });
}

function withStructured(
  base: HealthReport,
  structured: Exclude<HealthReport["structured"], "skipped">,
): HealthReport {
  return { ...base, structured, checkedAt: base.checkedAt };
}

function extractKeyLabel(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== "object") return undefined;
  const label = (data as { label?: unknown }).label;
  return typeof label === "string" ? label : undefined;
}
