/** Fixed categories and numeric counts only; never return provider text. */
export function completionMetadata(body: unknown) {
  const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const response = record(body);
  const choice = record(Array.isArray(response.choices) ? response.choices[0] : undefined);
  const message = record(choice.message);
  const usage = record(response.usage);
  const finish = choice.finish_reason;
  const content = message.content;
  let contentKind: "missing" | "empty" | "json" | "non-json" = "missing";
  if (typeof content === "string") {
    contentKind = content.length === 0 ? "empty" : "non-json";
    if (content.length > 0) {
      try { JSON.parse(content); contentKind = "json"; } catch { /* category only */ }
    }
  }
  return {
    finish: finish === "stop" || finish === "length" || finish === "content_filter" ? finish : "other",
    contentKind,
    completionTokens: count(usage.completion_tokens),
    reasoningTokens: count(record(usage.completion_tokens_details).reasoning_tokens),
  };
}
