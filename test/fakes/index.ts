/**
 * Shared test fakes (DESIGN §9). Import from `test/fakes` only — not deep paths from features.
 */

export { FakeClock, formatTodayLocal } from "./fake-clock";
export {
  FakeTransport,
  type FakeGetJsonResult,
  type FakePostStreamResult,
  type FakeTransportCall,
} from "./fake-transport";
export { MemoryStorage } from "./memory-storage";
export {
  ScriptedModel,
  type ModelPort,
  type ModelUsage,
  type ScriptedStep,
  type StructuredRequest,
  type StructuredResponse,
} from "./scripted-model";
export {
  DEFAULT_RING_CAPACITY,
  LOG_FIELD_MAX_CHARS,
  RingBufferLogger,
  type LogEvent,
  type RingBufferLoggerOptions,
} from "./ring-buffer-logger";
