/**
 * Single-lane priority JobQueue (DESIGN §5.4 / AC-M1.5–1.6).
 */

import {
  createObservable,
  err,
  synapseError,
  type Clock,
  type MutableObservable,
  type Observable,
  type Result,
  type SynapseError,
} from "../core";
import {
  abortReasonOf,
  JobContextImpl,
  type JobContext,
  type JobProgress,
} from "./context";

export type JobKind = "qa" | "health" | "contradiction" | "resurface";

/** Lower number runs first. */
export const PRIORITY: Record<JobKind, number> = {
  qa: 0,
  health: 0,
  contradiction: 1,
  resurface: 2,
};

export interface JobSpec<T> {
  kind: JobKind;
  /** Generic label only — never user or note text. */
  label: string;
  dedupeKey?: string;
  run(ctx: JobContext): Promise<Result<T>>;
}

export type JobState =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "cancelled";

export interface JobHandle<T> {
  id: string;
  result: Promise<Result<T>>;
  cancel(): void;
  state: Observable<JobState>;
}

export interface QueueStatus {
  model: "idle" | "running" | "paused" | "error";
  running?: { id: string; kind: JobKind; label: string };
  queued: number;
  lastError?: SynapseError;
}

export interface JobQueue {
  submit<T>(s: JobSpec<T>): JobHandle<T>;
  status: Observable<QueueStatus>;
  cancelAll(): void;
  dispose(): void;
}

export interface CreateJobQueueOptions {
  clock: Clock;
  /** From Transport.capabilities.abortable; default true. */
  abortable?: boolean;
}

type ResolveFn<T> = (r: Result<T>) => void;

interface InternalJob<T = unknown> {
  id: string;
  spec: JobSpec<T>;
  state: MutableObservable<JobState>;
  ctx: JobContextImpl;
  resolve: ResolveFn<T>;
  resultPromise: Promise<Result<T>>;
  settled: boolean;
  /** Result already delivered (e.g. cancel detach); lane may still be busy. */
  detached: boolean;
}

let nextId = 1;

function cancelledResult<T>(): Result<T> {
  return err(
    synapseError({
      code: "CANCELLED",
      message: "Job cancelled",
    }),
  );
}

function internalError(cause: unknown): SynapseError {
  return synapseError({
    code: "INTERNAL",
    message: "Job threw",
    cause,
  });
}

export function createJobQueue(options: CreateJobQueueOptions): JobQueue {
  const { clock, abortable = true } = options;
  const statusObs = createObservable<QueueStatus>({
    model: "idle",
    queued: 0,
  });

  const waiting: InternalJob[] = [];
  let current: InternalJob | null = null;
  let disposed = false;
  let pumping = false;

  function publishStatus(patch: {
    model: QueueStatus["model"];
    queued?: number;
    running?: QueueStatus["running"];
    lastError?: SynapseError;
    /** When true, keep previous lastError if patch omits one and model is error. */
    preserveError?: boolean;
  }): void {
    const prev = statusObs.get();
    const next: QueueStatus = {
      model: patch.model,
      queued: patch.queued ?? waiting.length,
    };
    if (patch.running !== undefined) {
      next.running = patch.running;
    } else if (patch.model === "running" && current) {
      next.running = {
        id: current.id,
        kind: current.spec.kind,
        label: current.spec.label,
      };
    }
    if (patch.lastError !== undefined) {
      next.lastError = patch.lastError;
    } else if (
      patch.preserveError &&
      prev.lastError !== undefined &&
      patch.model === "error"
    ) {
      next.lastError = prev.lastError;
    }
    statusObs.set(next);
  }

  function refreshIdleOrError(lastError?: SynapseError): void {
    if (lastError) {
      publishStatus({
        model: "error",
        queued: waiting.length,
        lastError,
      });
      return;
    }
    publishStatus({ model: "idle", queued: waiting.length });
  }

  function republishCurrent(): void {
    const prev = statusObs.get();
    const patch: {
      model: QueueStatus["model"];
      queued: number;
      running?: QueueStatus["running"];
      lastError?: SynapseError;
      preserveError?: boolean;
    } = {
      model: prev.model,
      queued: waiting.length,
    };
    if (prev.running !== undefined) {
      patch.running = prev.running;
    }
    if (prev.lastError !== undefined) {
      patch.lastError = prev.lastError;
    }
    if (prev.model === "error") {
      patch.preserveError = true;
    }
    publishStatus(patch);
  }

  function insertQueued(job: InternalJob, atHeadOfClass: boolean): void {
    const p = PRIORITY[job.spec.kind];
    let i = 0;
    while (i < waiting.length) {
      const at = waiting[i];
      if (!at || PRIORITY[at.spec.kind] >= p) {
        break;
      }
      i++;
    }
    if (!atHeadOfClass) {
      while (i < waiting.length) {
        const at = waiting[i];
        if (!at || PRIORITY[at.spec.kind] !== p) {
          break;
        }
        i++;
      }
    }
    waiting.splice(i, 0, job);
  }

  function resolveJob<T>(job: InternalJob<T>, result: Result<T>): void {
    if (job.settled) {
      return;
    }
    job.settled = true;
    job.resolve(result);
  }

  function cancelJob(job: InternalJob, fromQueue: boolean): void {
    if (
      job.state.get() === "done" ||
      job.state.get() === "failed" ||
      job.state.get() === "cancelled"
    ) {
      return;
    }

    if (fromQueue) {
      const idx = waiting.indexOf(job);
      if (idx >= 0) {
        waiting.splice(idx, 1);
      }
      job.state.set("cancelled");
      resolveJob(job, cancelledResult());
      if (!current) {
        const prevErr = statusObs.get().lastError;
        if (statusObs.get().model === "error" && prevErr) {
          refreshIdleOrError(prevErr);
        } else {
          refreshIdleOrError();
        }
      } else {
        republishCurrent();
      }
      return;
    }

    // Running job
    job.detached = true;
    job.state.set("cancelled");
    resolveJob(job, cancelledResult());
    job.ctx.abort({ kind: "cancelled" });
    if (!abortable) {
      // Lane stays occupied until the in-flight run settles.
      publishStatus({
        model: "running",
        queued: waiting.length,
        running: {
          id: job.id,
          kind: job.spec.kind,
          label: job.spec.label,
        },
      });
    }
  }

  function replaceByDedupe(incoming: InternalJob): void {
    const key = incoming.spec.dedupeKey;
    if (key === undefined) {
      return;
    }
    for (let i = waiting.length - 1; i >= 0; i--) {
      const other = waiting[i];
      if (other && other.spec.dedupeKey === key) {
        cancelJob(other, true);
      }
    }
    if (current && current.spec.dedupeKey === key && current !== incoming) {
      cancelJob(current, false);
    }
  }

  function maybePreemptFor(incoming: InternalJob): void {
    if (!current) {
      return;
    }
    if (PRIORITY[incoming.spec.kind] >= PRIORITY[current.spec.kind]) {
      return;
    }
    // Higher priority (lower number): abort-and-resume.
    publishStatus({
      model: "paused",
      queued: waiting.length + 1, // incoming not yet counted if caller inserts after
      running: {
        id: current.id,
        kind: current.spec.kind,
        label: current.spec.label,
      },
    });
    current.state.set("paused");
    current.ctx.abort({ kind: "preempted" });
  }

  async function runAttempt(job: InternalJob): Promise<"preempted" | "done"> {
    job.ctx.beginAttempt();
    job.state.set("running");
    current = job;
    publishStatus({
      model: "running",
      queued: waiting.length,
      running: {
        id: job.id,
        kind: job.spec.kind,
        label: job.spec.label,
      },
    });

    let outcome: Result<unknown>;
    let threw: unknown;
    try {
      outcome = await job.spec.run(job.ctx);
    } catch (e) {
      threw = e;
      outcome = err(internalError(e));
    }

    const reason = abortReasonOf(job.ctx.signal);

    if (reason?.kind === "preempted") {
      job.ctx.pauseActive();
      job.state.set("paused");
      insertQueued(job, true);
      current = null;
      publishStatus({ model: "paused", queued: waiting.length });
      return "preempted";
    }

    job.ctx.pauseActive();
    current = null;

    if (job.detached || reason?.kind === "cancelled") {
      job.state.set("cancelled");
      resolveJob(job, cancelledResult());
      refreshIdleOrError(statusObs.get().lastError);
      return "done";
    }

    if (threw !== undefined) {
      const error = internalError(threw);
      job.state.set("failed");
      resolveJob(job, err(error));
      publishStatus({
        model: "error",
        queued: waiting.length,
        lastError: error,
      });
      return "done";
    }

    if (outcome.ok) {
      job.state.set("done");
      resolveJob(job, outcome);
      refreshIdleOrError(undefined);
      return "done";
    }

    // Result err from run
    if (outcome.error.code === "CANCELLED") {
      job.state.set("cancelled");
      resolveJob(job, outcome);
      const prevErr = statusObs.get().lastError;
      if (statusObs.get().model === "error" && prevErr) {
        refreshIdleOrError(prevErr);
      } else {
        refreshIdleOrError();
      }
      return "done";
    }

    job.state.set("failed");
    resolveJob(job, outcome);
    publishStatus({
      model: "error",
      queued: waiting.length,
      lastError: outcome.error,
    });
    return "done";
  }

  async function pump(): Promise<void> {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (!disposed) {
        if (current) {
          return;
        }
        const next = waiting.shift();
        if (!next) {
          const prev = statusObs.get();
          if (prev.model === "error" && prev.lastError) {
            publishStatus({
              model: "error",
              queued: 0,
              lastError: prev.lastError,
            });
          } else {
            refreshIdleOrError();
          }
          return;
        }
        if (
          next.state.get() === "cancelled" ||
          next.settled && next.state.get() !== "paused"
        ) {
          continue;
        }
        await runAttempt(next);
        // After preempt, loop picks the higher-priority waiter.
      }
    } finally {
      pumping = false;
      // If work was enqueued while we were finishing, continue.
      if (!disposed && !current && waiting.length > 0) {
        void pump();
      }
    }
  }

  function schedulePump(): void {
    void pump();
  }

  return {
    status: statusObs,

    submit<T>(spec: JobSpec<T>): JobHandle<T> {
      if (disposed) {
        const state = createObservable<JobState>("cancelled");
        return {
          id: `job-${nextId++}`,
          result: Promise.resolve(cancelledResult<T>()),
          cancel() {},
          state,
        };
      }

      let resolve!: ResolveFn<T>;
      const resultPromise = new Promise<Result<T>>((r) => {
        resolve = r;
      });

      const job: InternalJob<T> = {
        id: `job-${nextId++}`,
        spec,
        state: createObservable<JobState>("queued"),
        ctx: new JobContextImpl(clock),
        resolve,
        resultPromise,
        settled: false,
        detached: false,
      };

      replaceByDedupe(job as InternalJob);
      maybePreemptFor(job as InternalJob);
      insertQueued(job as InternalJob, false);

      if (!current) {
        const prev = statusObs.get();
        if (prev.model === "error" && prev.lastError) {
          publishStatus({
            model: "error",
            queued: waiting.length,
            lastError: prev.lastError,
          });
        } else {
          publishStatus({ model: "idle", queued: waiting.length });
        }
      } else {
        const model =
          abortReasonOf(current.ctx.signal)?.kind === "preempted"
            ? "paused"
            : "running";
        const patch: {
          model: "running" | "paused";
          queued: number;
          running: { id: string; kind: JobKind; label: string };
          lastError?: SynapseError;
        } = {
          model,
          queued: waiting.length,
          running: {
            id: current.id,
            kind: current.spec.kind,
            label: current.spec.label,
          },
        };
        const prevErr = statusObs.get().lastError;
        if (prevErr !== undefined) {
          patch.lastError = prevErr;
        }
        publishStatus(patch);
      }

      schedulePump();

      return {
        id: job.id,
        result: resultPromise,
        cancel: () => {
          if (current === (job as InternalJob)) {
            cancelJob(job as InternalJob, false);
          } else {
            cancelJob(job as InternalJob, true);
          }
        },
        state: job.state,
      };
    },

    cancelAll(): void {
      const queued = [...waiting];
      for (const j of queued) {
        cancelJob(j, true);
      }
      if (current) {
        cancelJob(current, false);
      }
    },

    dispose(): void {
      disposed = true;
      this.cancelAll();
      waiting.length = 0;
      if (!current) {
        publishStatus({ model: "idle", queued: 0 });
      }
    },
  };
}

// Re-export context types used by JobSpec callers.
export type { JobContext, JobProgress };
