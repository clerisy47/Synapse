import { expect, it } from "vitest";
import { completionMetadata } from "./completion-metadata";

it("reports reasoning exhaustion without returning provider content", () => {
  expect(completionMetadata({ choices: [{ finish_reason: "length", message: { content: null, reasoning: "PRIVATE" } }], usage: { completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 200 } } }))
    .toEqual({ finish: "length", contentKind: "missing", completionTokens: 200, reasoningTokens: 200 });
});

it("projects hostile metadata and malformed token counts into fixed categories", () => {
  expect(completionMetadata({ choices: [{ finish_reason: "SECRET", message: { content: "SECRET" } }], usage: { completion_tokens: "SECRET", completion_tokens_details: { reasoning_tokens: -1 } } }))
    .toEqual({ finish: "other", contentKind: "non-json", completionTokens: null, reasoningTokens: null });
  expect(completionMetadata(null)).toEqual({ finish: "other", contentKind: "missing", completionTokens: null, reasoningTokens: null });
});

it.each([["", "empty"], ['{"ok":true}', "json"]])("categorizes content without returning it (%s)", (content, contentKind) => {
  expect(completionMetadata({ choices: [{ finish_reason: "stop", message: { content } }] }).contentKind).toBe(contentKind);
});
