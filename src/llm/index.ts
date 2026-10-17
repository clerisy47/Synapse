export type {
  AllowedJsonSchemaKeyword,
  AnswerOutput,
  HealthOutput,
  PlanOutput,
  PromptKind,
  ProposalOutput,
  ProviderJsonSchema,
  SelectOutput,
} from "./schemas";

export {
  ALLOWED_JSON_SCHEMA_KEYWORDS,
  MODEL_OUTPUT_JSON_SCHEMAS,
  MODEL_OUTPUT_SCHEMAS,
  answerOutputSchema,
  assertAllSchemasInSubset,
  collectJsonSchemaKeywords,
  emitProviderJsonSchema,
  healthOutputSchema,
  planOutputSchema,
  proposalOutputSchema,
  schemaSubsetViolations,
  selectOutputSchema,
} from "./schemas";

export type {
  ModelPort,
  ModelUsage,
  OpenRouterClientOptions,
  StructuredRequest,
  StructuredResponse,
} from "./client";
export {
  OpenRouterClient,
  authHeaders,
  mapTransportFailure,
} from "./client";

export type {
  AiAvailability,
  HealthChecker,
  HealthReport,
  OpenRouterHealthCheckerOptions,
} from "./health";
export {
  OpenRouterHealthChecker,
  createOpenRouterHealthChecker,
} from "./health";

export type {
  BuildOpenRouterChatRequestArgs,
  OpenRouterChatMessage,
  OpenRouterChatRequest,
} from "./request";
export {
  SHARED_SYSTEM_PREFIX,
  buildOpenRouterChatRequest,
  joinEndpoint,
} from "./request";

export type { UsageFields } from "./validate";
export {
  extractChatContent,
  extractUsage,
  formatValidationFeedback,
  parseStructuredContent,
} from "./validate";

export { BonsaiClient } from "./client";
export { buildBonsaiChatRequest } from "./request";
