import { BONSAI_MAX_OUTPUT, BONSAI_SAMPLING } from "../constants";
import { MODEL_OUTPUT_JSON_SCHEMAS, type PromptKind } from "./schemas";
/**
 * OpenRouter production request builder (DESIGN §5.4 / §5.6.1).
 * HealthChecker.full must use the same shape as every generate call.
 */

/** Byte-identical system prefix on every request (KV-cache / prompt stability). */
export const SHARED_SYSTEM_PREFIX =
  "You are a structured-output assistant for Vault Synapse. Reply with JSON only that matches the requested schema. Do not include markdown fences or commentary." as const;

export type OpenRouterChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenRouterChatRequest = {
  model: string;
  messages: OpenRouterChatMessage[];
  temperature: 0;
  max_tokens?: number;
  response_format: { type: "json_object" };
};

export type BuildOpenRouterChatRequestArgs = {
  model: string;
  instructions: string;
  input: string;
  /** null leaves output length to the provider. */
  maxTokens: number | null;
  /** Optional schema-retry feedback appended as a second user message. */
  validationFeedback?: string;
};

/** Sole OpenRouter chat body builder — callers must not invent alternate shapes. */
export function buildOpenRouterChatRequest(
  args: BuildOpenRouterChatRequestArgs,
): OpenRouterChatRequest {
  const messages: OpenRouterChatMessage[] = [
    { role: "system", content: SHARED_SYSTEM_PREFIX },
    {
      role: "user",
      content: `${args.instructions}\n\n${args.input}`,
    },
  ];
  if (args.validationFeedback !== undefined && args.validationFeedback.length > 0) {
    messages.push({ role: "user", content: args.validationFeedback });
  }
  return {
    model: args.model,
    messages,
    temperature: 0,
    ...(args.maxTokens === null ? {} : { max_tokens: args.maxTokens }),
    response_format: { type: "json_object" },
  };
}

/** Join base URL (no trailing slash required) with a path starting with `/`. */
export function joinEndpoint(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Sole Prism llama.cpp request builder; grammar decoding never replaces Zod. */
export function buildBonsaiChatRequest(args: BuildOpenRouterChatRequestArgs & { kind: PromptKind }) {
  const base = buildOpenRouterChatRequest(args);
  return { ...base, ...BONSAI_SAMPLING,
    max_tokens: Math.min(args.maxTokens ?? BONSAI_MAX_OUTPUT, BONSAI_MAX_OUTPUT),
    response_format: { type: "json_schema", json_schema: {
      name: "synapse", strict: true, schema: MODEL_OUTPUT_JSON_SCHEMAS[args.kind],
    } },
  };
}
