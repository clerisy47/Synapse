/**
 * OpenRouter ModelPort (DESIGN §5.4 / §5.6.1, Phase A).
 */

import type { z } from "zod";

import {
  PLUGIN_NAME,
  TIMEOUT_FIRST_BYTE_MS,
  TIMEOUT_IDLE_MS,
} from "../constants";
import {
  err,
  ok,
  synapseError,
  TransportError,
  type Result,
  type SynapseError,
  type Transport,
} from "../core";
import type { PromptKind } from "./schemas";
import { buildOpenRouterChatRequest, joinEndpoint } from "./request";
import {
  extractChatContent,
  extractUsage,
  formatValidationFeedback,
  parseStructuredContent,
} from "./validate";

export type ModelUsage = {
  promptTokens: number;
  outputTokens: number;
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
  totalMs: number;
};

export type StructuredResponse<T> = {
  value: T;
  usage: ModelUsage;
  attempts: 1 | 2;
};

export type StructuredRequest<T> = {
  kind: PromptKind;
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  numPredict: number;
};

export interface ModelPort {
  generate<T>(
    req: StructuredRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<StructuredResponse<T>>>;
}

export type OpenRouterClientOptions = {
  transport: Transport;
  endpoint: string;
  model: string;
  apiKey: string | null;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
};

const ZERO_TIMING = {
  loadMs: 0,
  promptEvalMs: 0,
  evalMs: 0,
  totalMs: 0,
} as const;

export class OpenRouterClient implements ModelPort {
  private readonly transport: Transport;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly apiKey: string | null;
  private readonly firstByteTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(opts: OpenRouterClientOptions) {
    this.transport = opts.transport;
    this.endpoint = opts.endpoint;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.firstByteTimeoutMs = opts.firstByteTimeoutMs ?? TIMEOUT_FIRST_BYTE_MS;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? TIMEOUT_IDLE_MS;
  }

  async generate<T>(
    req: StructuredRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<StructuredResponse<T>>> {
    if (signal.aborted) {
      return err(cancelledError());
    }

    const key = this.apiKey?.trim() ?? "";
    if (key.length === 0) {
      return err(
        synapseError({
          code: "MODEL_HTTP_ERROR",
          message: "OpenRouter API key is missing",
          remediation: "set_api_key",
        }),
      );
    }

    const url = joinEndpoint(this.endpoint, "/chat/completions");
    const headers = authHeaders(key);

    const first = await this.callOnce(url, headers, req, signal);
    if (!first.ok) {
      if (first.error.code === "FORMAT_IGNORED") {
        return err(first.error);
      }
      if (first.error.code !== "SCHEMA_INVALID") {
        return err(first.error);
      }
      // Schema invalid → exactly one retry with validator feedback (AC-M1.4).
      if (signal.aborted) {
        return err(cancelledError());
      }
      const second = await this.callOnce(
        url,
        headers,
        req,
        signal,
        formatValidationFeedback(first.error),
      );
      if (!second.ok) {
        return err(second.error);
      }
      return ok({
        value: second.value.value,
        usage: second.value.usage,
        attempts: 2,
      });
    }

    return ok({
      value: first.value.value,
      usage: first.value.usage,
      attempts: 1,
    });
  }

  private async callOnce<T>(
    url: string,
    headers: Record<string, string>,
    req: StructuredRequest<T>,
    signal: AbortSignal,
    validationFeedback?: string,
  ): Promise<Result<{ value: T; usage: ModelUsage }>> {
    const buildArgs: Parameters<typeof buildOpenRouterChatRequest>[0] = {
      model: this.model,
      instructions: req.instructions,
      input: req.input,
      maxTokens: req.numPredict,
    };
    if (validationFeedback !== undefined) {
      buildArgs.validationFeedback = validationFeedback;
    }
    const body = buildOpenRouterChatRequest(buildArgs);

    let responseBody: unknown;
    try {
      responseBody = await this.postChat(url, body, headers, signal, true);
    } catch (cause) {
      return err(mapTransportFailure(cause));
    }

    if (signal.aborted) {
      return err(cancelledError());
    }

    const content = extractChatContent(responseBody);
    if (content === null) {
      return err(
        synapseError({
          code: "FORMAT_IGNORED",
          message: "chat completion missing message content",
          remediation: "format_ignored",
        }),
      );
    }

    const parsed = parseStructuredContent(content, req.schema);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    const tokens = extractUsage(responseBody);
    return ok({
      value: parsed.value,
      usage: {
        promptTokens: tokens.promptTokens,
        outputTokens: tokens.outputTokens,
        ...ZERO_TIMING,
      },
    });
  }

  /**
   * POST chat/completions; optionally retry once on HTTP 5xx (DESIGN §5.3).
   */
  private async postChat(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    signal: AbortSignal,
    allowHttpRetry: boolean,
  ): Promise<unknown> {
    try {
      return await collectLastChunk(
        this.transport.postStream(url, body, {
          signal,
          firstByteTimeoutMs: this.firstByteTimeoutMs,
          idleTimeoutMs: this.idleTimeoutMs,
          headers,
        }),
      );
    } catch (cause) {
      if (
        allowHttpRetry &&
        cause instanceof TransportError &&
        cause.kind === "http" &&
        cause.status !== undefined &&
        cause.status >= 500 &&
        cause.status < 600 &&
        !signal.aborted
      ) {
        return this.postChat(url, body, headers, signal, false);
      }
      throw cause;
    }
  }
}

export function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Title": PLUGIN_NAME,
  };
}

export function mapTransportFailure(cause: unknown): SynapseError {
  if (!(cause instanceof TransportError)) {
    return synapseError({
      code: "INTERNAL",
      message: "unexpected transport failure",
      cause,
    });
  }

  if (cause.kind === "aborted") {
    return cancelledError();
  }
  if (cause.kind === "timeout_first_byte" || cause.kind === "timeout_idle") {
    return synapseError({
      code: "MODEL_TIMEOUT",
      message: cause.message,
      remediation: "model_timeout",
      cause,
    });
  }
  if (cause.kind === "blocked") {
    return synapseError({
      code: "ENDPOINT_BLOCKED",
      message: cause.message,
      remediation: "endpoint_blocked",
      cause,
    });
  }
  if (cause.kind === "http") {
    const status = cause.status ?? 0;
    if (status === 401 || status === 403) {
      return synapseError({
        code: "MODEL_HTTP_ERROR",
        message: "OpenRouter authentication failed",
        remediation: "auth_failed",
        detail: { status },
        cause,
      });
    }
    if (status === 429) {
      return synapseError({
        code: "MODEL_HTTP_ERROR",
        message: "OpenRouter rate limit exceeded",
        remediation: "rate_limited",
        detail: { status },
        cause,
      });
    }
    if (status === 404) {
      return synapseError({
        code: "MODEL_NOT_FOUND",
        message: "OpenRouter model not found",
        remediation: "model_not_found",
        detail: { status },
        cause,
      });
    }
    if (status > 0) {
      return synapseError({
        code: "MODEL_HTTP_ERROR",
        message: `OpenRouter HTTP ${status}`,
        remediation: "model_http_error",
        detail: { status },
        cause,
      });
    }
    return synapseError({
      code: "MODEL_HTTP_ERROR",
      message: "OpenRouter HTTP error",
      remediation: "model_http_error",
      cause,
    });
  }
  if (cause.kind === "refused" || cause.kind === "dns") {
    return synapseError({
      code: "MODEL_HTTP_ERROR",
      message: "OpenRouter endpoint unreachable",
      remediation: "endpoint_unreachable",
      cause,
    });
  }
  return synapseError({
    code: "MODEL_HTTP_ERROR",
    message: cause.message || "OpenRouter transport error",
    remediation: "model_http_error",
    cause,
  });
}

function cancelledError(): SynapseError {
  return synapseError({
    code: "CANCELLED",
    message: "model request cancelled",
  });
}

async function collectLastChunk(
  stream: AsyncIterable<unknown>,
): Promise<unknown> {
  let last: unknown = undefined;
  let saw = false;
  for await (const chunk of stream) {
    last = chunk;
    saw = true;
  }
  if (!saw) {
    throw new TransportError({
      kind: "protocol",
      message: "empty chat completion response",
    });
  }
  return last;
}
