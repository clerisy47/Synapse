/**
 * Shared test fakes (DESIGN §9). Import from `test/fakes` only — not deep paths from features.
 */

export { FakeClock, formatTodayLocal } from "./fake-clock";
export {
  FakeVault,
  type FakeVaultNoteSeed,
  type FakeVaultPdfSeed,
} from "./fake-vault";
export {
  FakeCorpus,
  type FakeCorpusNoteSeed,
  type FakeCorpusOptions,
  type FakeCorpusPdfSeed,
} from "./fake-corpus";
export { FakeMetadata } from "./fake-metadata";
export { FakeActiveNote } from "./fake-active-note";
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
