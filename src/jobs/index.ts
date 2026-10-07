/**
 * jobs — single-lane priority queue (DESIGN §5.4).
 */

export type {
  JobAbortReason,
  JobContext,
  JobProgress,
} from "./context";
export { abortReasonOf, JobAbortError, JobContextImpl } from "./context";

export type {
  CreateJobQueueOptions,
  JobHandle,
  JobKind,
  JobQueue,
  JobSpec,
  JobState,
  QueueStatus,
} from "./queue";
export { createJobQueue, PRIORITY } from "./queue";
