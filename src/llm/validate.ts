/**
 * Parse + zod-validate OpenRouter chat completion content (DESIGN §5.4).
 */

import type { z } from "zod";

import { err, ok, synapseError, type Result, type SynapseError } from "../core";

/** Pull assistant text from an OpenAI-compatible chat completion body. */
export function extractChatContent(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (first === null || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (message === null || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  return content;
}

export type UsageFields = {
  promptTokens: number;
  outputTokens: number;
};

export function extractUsage(body: unknown): UsageFields {
  if (body === null || typeof body !== "object") {
    return { promptTokens: 0, outputTokens: 0 };
  }
  const usage = (body as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") {
    return { promptTokens: 0, outputTokens: 0 };
  }
  const u = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  return {
    promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
    outputTokens:
      typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
  };
}

/**
 * Parse JSON content then zod-validate.
 * Non-JSON → FORMAT_IGNORED; JSON that fails schema → SCHEMA_INVALID.
 */
export function parseStructuredContent<T>(
  content: string,
  schema: z.ZodType<T>,
): Result<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (cause: unknown) {
    return err(
      synapseError({
        code: "FORMAT_IGNORED",
        message: "model returned non-JSON content despite response_format",
        remediation: "format_ignored",
        cause,
      }),
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err(
      synapseError({
        code: "SCHEMA_INVALID",
        message: "model JSON failed schema validation",
        remediation: "schema_invalid",
        detail: { issues: clipIssues(result.error) },
      }),
    );
  }
  return ok(result.data);
}

/** User-message feedback for the single schema retry (AC-M1.4). */
export function formatValidationFeedback(error: SynapseError): string {
  const issues =
    error.detail && typeof error.detail.issues === "string"
      ? error.detail.issues
      : error.message;
  return `Your previous reply failed validation (${error.code}). Fix the JSON to satisfy the schema. Issues: ${issues}`;
}

function clipIssues(error: z.ZodError): string {
  const text = error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
