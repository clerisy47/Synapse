import { describe, expect, it } from "vitest";

import { healthOutputSchema } from "./schemas";
import {
  extractChatContent,
  extractUsage,
  formatValidationFeedback,
  parseStructuredContent,
} from "./validate";

describe("extractChatContent", () => {
  it("reads choices[0].message.content", () => {
    expect(
      extractChatContent({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    ).toBe('{"ok":true}');
  });

  it("returns null when content is missing", () => {
    expect(extractChatContent({ choices: [] })).toBeNull();
    expect(extractChatContent(null)).toBeNull();
  });
});

describe("extractUsage", () => {
  it("maps OpenAI usage fields", () => {
    expect(
      extractUsage({
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      }),
    ).toEqual({ promptTokens: 3, outputTokens: 5 });
  });
});

describe("parseStructuredContent", () => {
  it("accepts valid health JSON", () => {
    const r = parseStructuredContent('{"ok":true}', healthOutputSchema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ ok: true });
  });

  it("returns FORMAT_IGNORED for non-JSON", () => {
    const r = parseStructuredContent("not json", healthOutputSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORMAT_IGNORED");
  });

  it("returns SCHEMA_INVALID for wrong JSON shape", () => {
    const r = parseStructuredContent('{"ok":"yes"}', healthOutputSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("SCHEMA_INVALID");
      expect(formatValidationFeedback(r.error)).toContain("SCHEMA_INVALID");
    }
  });
});
