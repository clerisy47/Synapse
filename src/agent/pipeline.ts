/**
 * QaPipeline.run — plan→search→select→read→answer→verify (DESIGN §5.4 / §6.2).
 */

import {
  err,
  ok,
  synapseError,
  type Excerpt,
  type ExcerptId,
  type Result,
  type SynapseError,
  type VaultPath,
} from "../core";
import {
  EvidenceLedger,
  titleFromPath,
} from "../evidence";
import type { JobContext } from "../jobs";
import {
  answerOutputSchema,
  planOutputSchema,
  type AnswerOutput,
  type ModelPort,
  type ModelUsage,
  type PlanOutput,
} from "../llm";
import {
  createDuplicateTracker,
  type ToolName,
  type ToolRegistry,
  type SearchTextResult,
  type SearchByTitleResult,
  type SearchByTagResult,
  type ListRecentResult,
  type ReadNoteResult,
} from "../tools";
import {
  attachAnchors,
  collectUnknownSourceIds,
  mapAnswerClaims,
  markUnknownClaimsUnverified,
  orderEvidenceIds,
  type AnswerClaim,
  type ResolveNoteText,
} from "./answer";
import {
  canSearch,
  createRunBudget,
  maxPromptTokens,
  mustForceAnswer,
  remainingReads,
  type CreateRunBudgetOpts,
  type RunBudget,
} from "./budget";
import {
  historyForPrompt,
  type QaInput,
} from "./chat-session";
import {
  initialState,
  isRejected,
  next,
  type AgentPhase,
  type AgentState,
  type HopRejectReason,
} from "./machine";

/** Break control-flow narrowing after `state` mutates via `apply`. */
function phaseOf(s: AgentState): AgentPhase {
  return s.phase;
}
import {
  buildAnswerPrompt,
  buildPlanPrompt,
  formatCompactSelectLines,
  QA_NUM_PREDICT,
  type CompactSelectLine,
} from "./prompts";
import {
  createSelector,
  type EvidenceSelector,
  type SelectorStrategy,
} from "./selector";

/** Duck-typed index status (agent must not import corpus). */
export type QaIndexStatus = {
  phase: "warming" | "ready";
  indexedNotes: number;
  totalNotes: number;
  pdfIndexed: number;
  pdfTotal: number;
  bytesCached: number;
};

export type QaStage =
  | "queued"
  | "planning"
  | "searching"
  | "selecting"
  | "reading"
  | "answering"
  | "verifying";

export type TraceHop = {
  n: number;
  tool: ToolName;
  args: unknown;
  resultCount: number;
  ms: number;
  rejected?: "duplicate" | "invalid_args" | "budget";
};

export type QaEvent =
  | { type: "stage"; stage: QaStage }
  | { type: "hop"; hop: TraceHop };

export type QaResult = {
  status: "answered" | "insufficient";
  claims: AnswerClaim[];
  trace: TraceHop[];
  stats: {
    modelCalls: number;
    hops: number;
    reads: number;
    activeMs: number;
    promptTokens: number;
    outputTokens: number;
  };
  indexStatus?: QaIndexStatus;
};

export interface QaPipeline {
  run(
    input: QaInput,
    ctx: JobContext,
    emit: (e: QaEvent) => void,
  ): Promise<Result<QaResult>>;
}

export type CreateQaPipelineOpts = {
  model: ModelPort;
  tools: ToolRegistry;
  readText: ResolveNoteText;
  /** Default false (S2 off). */
  multiTurn?: boolean;
  budget?: CreateRunBudgetOpts;
  /** Default `model`. */
  selectorStrategy?: SelectorStrategy;
  selector?: EvidenceSelector;
  /** Present when index was still warming at run start. */
  indexStatus?: QaIndexStatus;
  /** Context window for prompt trimming; default 8192. */
  numCtx?: number;
};

const SEARCH_ORDER: PlanSearchTool[] = [
  "search_text",
  "search_by_title",
  "search_by_tag",
  "list_recent",
];

type PlanSearchTool =
  | "search_text"
  | "search_by_title"
  | "search_by_tag"
  | "list_recent";

type PlannedSearch = {
  tool: PlanSearchTool;
  args: Record<string, unknown>;
};

type ScoredCandidate = {
  id: ExcerptId;
  score: number;
  path: VaultPath;
};

const READ_PAD = 1000;
const DEFAULT_NUM_CTX = 8192;
const ZERO_USAGE: ModelUsage = {
  promptTokens: 0,
  outputTokens: 0,
  loadMs: 0,
  promptEvalMs: 0,
  evalMs: 0,
  totalMs: 0,
};

export function createQaPipeline(opts: CreateQaPipelineOpts): QaPipeline {
  const multiTurn = opts.multiTurn ?? false;
  const numCtx = opts.numCtx ?? DEFAULT_NUM_CTX;
  const selector =
    opts.selector ??
    createSelector(opts.selectorStrategy ?? "model", opts.model);

  return {
    async run(input, ctx, emit) {
      const runArgs: RunArgs = {
        input,
        ctx,
        emit,
        model: opts.model,
        tools: opts.tools,
        readText: opts.readText,
        multiTurn,
        selector,
        budget: createRunBudget(opts.budget),
        numCtx,
      };
      if (opts.indexStatus !== undefined) {
        runArgs.indexStatus = opts.indexStatus;
      }
      return runPipeline(runArgs);
    },
  };
}

type RunArgs = {
  input: QaInput;
  ctx: JobContext;
  emit: (e: QaEvent) => void;
  model: ModelPort;
  tools: ToolRegistry;
  readText: ResolveNoteText;
  multiTurn: boolean;
  selector: EvidenceSelector;
  budget: RunBudget;
  indexStatus?: QaIndexStatus;
  numCtx: number;
};

async function runPipeline(args: RunArgs): Promise<Result<QaResult>> {
  const { input, ctx, emit, budget } = args;
  const stage = (s: QaStage) => {
    emit({ type: "stage", stage: s });
    ctx.progress({ stage: s });
  };

  stage("queued");
  stage("planning");

  const abortErr = checkAbort(ctx);
  if (abortErr) {
    return err(abortErr);
  }

  const ledger = new EvidenceLedger();
  const dup = createDuplicateTracker();
  const trace: TraceHop[] = [];
  let state = initialState();
  let modelCalls = 0;
  let promptTokens = 0;
  let outputTokens = 0;
  let hopSerial = 0;
  const scored: ScoredCandidate[] = [];
  const allIds: ExcerptId[] = [];
  let selectedIds: ExcerptId[] = [];
  let planned: PlannedSearch[] = [];
  let expandGraph = false;
  let lastAnswer: AnswerOutput | null = null;
  let claims: AnswerClaim[] = [];
  let unknownForRetry: string[] | undefined;
  let followupPending: PlannedSearch[] | null = null;

  const apply = (event: Parameters<typeof next>[1]): Result<void> => {
    const r = next(state, event, budget, ctx.activeMs());
    if (isRejected(r)) {
      return err(
        synapseError({
          code: "INTERNAL",
          message: `agent rejected: ${r.rejected}`,
        }),
      );
    }
    state = r;
    return ok(undefined);
  };

  const finish = (): Result<QaResult> => {
    const status: QaResult["status"] =
      state.phase === "DONE" && lastAnswer?.status === "answered"
        ? "answered"
        : "insufficient";
    const result: QaResult = {
      status,
      claims: status === "insufficient" ? [] : claims,
      trace,
      stats: {
        modelCalls,
        hops: state.hops,
        reads: state.reads,
        activeMs: ctx.activeMs(),
        promptTokens,
        outputTokens,
      },
    };
    if (args.indexStatus !== undefined) {
      result.indexStatus = args.indexStatus;
    }
    return ok(result);
  };

  const addUsage = (usage: ModelUsage | undefined) => {
    const u = usage ?? ZERO_USAGE;
    promptTokens += u.promptTokens;
    outputTokens += u.outputTokens;
  };

  // --- PLAN ---
  {
    const planResult = await ctx.step("qa:plan", async () => {
      const history = historyForPrompt(input, args.multiTurn);
      const prompt = buildPlanPrompt(input.question, history);
      return args.model.generate<PlanOutput>(
        {
          kind: "qa.plan",
          instructions: prompt.instructions,
          input: prompt.input,
          schema: planOutputSchema,
          numPredict: QA_NUM_PREDICT.plan,
        },
        ctx.signal,
      );
    });
    if (!planResult.ok) {
      return err(planResult.error);
    }
    modelCalls += 1;
    addUsage(planResult.value.usage);

    const validated = validatePlan(planResult.value.value);
    planned = validated.searches;
    expandGraph = validated.expand_graph;

    if (planned.length === 0) {
      const t = apply({ type: "planEmpty" });
      if (!t.ok) {
        return t;
      }
      return finish();
    }
    const t = apply({ type: "planAccepted" });
    if (!t.ok) {
      return t;
    }
  }

  // Main phase loop
  while (state.phase !== "DONE" && state.phase !== "INSUFFICIENT") {
    const aborted = checkAbort(ctx);
    if (aborted) {
      return err(aborted);
    }
    if (ctx.activeMs() >= budget.wallClockMs) {
      const t = apply({ type: "wallClockExhausted" });
      if (!t.ok) {
        return t;
      }
      break;
    }

    if (
      (state.phase === "SEARCH" ||
        state.phase === "SELECT" ||
        state.phase === "READ") &&
      mustForceAnswer(budget, ctx.activeMs())
    ) {
      const t = apply({ type: "forceAnswer" });
      if (!t.ok) {
        return t;
      }
      continue;
    }

    if (state.phase === "SEARCH") {
      stage("searching");
      const searches =
        followupPending !== null ? followupPending : planned;
      followupPending = null;

      const ordered = sortSearches(searches);
      for (const search of ordered) {
        if (state.phase !== "SEARCH") {
          break;
        }
        if (!canSearch(budget, ctx.activeMs(), state.hops)) {
          const hop = await recordHop({
            tools: args.tools,
            dup,
            tool: search.tool,
            rawArgs: search.args,
            ctx,
            emit,
            trace,
            hopSerial: ++hopSerial,
            forceReject: "budget",
          });
          const t = apply({
            type: "toolHop",
            rejected: hop.rejected,
          });
          if (!t.ok) {
            return t;
          }
          break;
        }

        const hop = await invokeToolHop({
          tools: args.tools,
          dup,
          tool: search.tool,
          rawArgs: search.args,
          ctx,
          emit,
          trace,
          hopSerial: ++hopSerial,
        });
        const t = apply({
          type: "toolHop",
          ...(hop.rejected !== undefined
            ? { rejected: hop.rejected }
            : {}),
        });
        if (!t.ok) {
          return t;
        }
        if (phaseOf(state) === "INSUFFICIENT") {
          break;
        }
        if (hop.data !== undefined && hop.rejected === undefined) {
          ingestSearchResult(
            search.tool,
            hop.data,
            ledger,
            scored,
            allIds,
          );
        }
      }

      if (phaseOf(state) === "SEARCH" && expandGraph && scored.length > 0) {
        const topPaths = uniqueTopPaths(scored, 3);
        if (topPaths.length > 0) {
          for (const tool of ["get_links", "get_backlinks"] as const) {
            if (state.phase !== "SEARCH") {
              break;
            }
            if (!canSearch(budget, ctx.activeMs(), state.hops)) {
              break;
            }
            const rawArgs =
              tool === "get_links"
                ? { paths: topPaths }
                : { paths: topPaths };
            const hop = await invokeToolHop({
              tools: args.tools,
              dup,
              tool,
              rawArgs,
              ctx,
              emit,
              trace,
              hopSerial: ++hopSerial,
            });
            const t = apply({
              type: "toolHop",
              ...(hop.rejected !== undefined
                ? { rejected: hop.rejected }
                : {}),
            });
            if (!t.ok) {
              return t;
            }
            // Graph results are path refs only — hops counted; no excerpts.
            void hop.data;
          }
        }
      }

      if (state.phase === "SEARCH") {
        const t = apply({ type: "searchDone" });
        if (!t.ok) {
          return t;
        }
      }
      continue;
    }

    if (state.phase === "SELECT") {
      stage("selecting");
      const candidateIds = scored.map((s) => s.id);
      const lines: CompactSelectLine[] = [];
      for (const c of scored) {
        const ex = ledger.get(c.id);
        if (ex === undefined) {
          continue;
        }
        const line: CompactSelectLine = {
          id: c.id,
          title: titleFromPath(ex.ref.path),
          snippet: ex.text.slice(0, 160),
        };
        if (ex.locator.heading) {
          line.heading = ex.locator.heading;
        }
        lines.push(line);
      }
      const selectBudget = maxPromptTokens(args.numCtx, QA_NUM_PREDICT.select);
      const compact = formatCompactSelectLines(lines, selectBudget);

      const selectResult = await ctx.step(
        `qa:select:${state.modelCalls}`,
        () =>
          args.selector.select({
            question: input.question,
            candidateIds:
              compact.included.length > 0 ? compact.included : candidateIds,
            compactRender: compact.text,
            maxReads: remainingReads(budget, state.reads),
            signal: ctx.signal,
          }),
      );
      if (!selectResult.ok) {
        return err(selectResult.error);
      }
      if (selectResult.value.usage) {
        modelCalls += 1;
        addUsage(selectResult.value.usage);
      }

      // enough → skip READ (pass empty readIds to the machine).
      const enough = selectResult.value.enough;
      const readIds = enough ? [] : selectResult.value.readIds;
      selectedIds =
        selectResult.value.readIds.length > 0
          ? selectResult.value.readIds
          : candidateIds.slice(0, 1);

      const t = apply({
        type: "select",
        readIds,
        enough,
      });
      if (!t.ok) {
        return t;
      }

      if (phaseOf(state) === "READ") {
        // stash ids for READ loop
        selectedIds = selectResult.value.readIds;
      }
      continue;
    }

    if (state.phase === "READ") {
      stage("reading");
      for (const id of selectedIds) {
        if (state.phase !== "READ") {
          break;
        }
        const ex = ledger.get(id);
        if (ex === undefined) {
          continue;
        }
        const start = Math.max(0, ex.locator.start - READ_PAD);
        const span = Math.max(1, ex.locator.end - ex.locator.start);
        const maxChars = span + 2 * READ_PAD;
        const rawArgs = {
          path: ex.ref.path,
          page: 1,
          window: { start, maxChars },
        };
        const hop = await invokeToolHop({
          tools: args.tools,
          dup,
          tool: "read_note",
          rawArgs,
          ctx,
          emit,
          trace,
          hopSerial: ++hopSerial,
        });
        // Reads count via readsDone, not toolHop — but duplicates still traced.
        if (hop.rejected === undefined && hop.data !== undefined) {
          const data = hop.data as ReadNoteResult;
          for (const excerpt of data.excerpts) {
            const nid = ledger.add(excerpt);
            if (!allIds.includes(nid)) {
              allIds.push(nid);
            }
            if (!selectedIds.includes(nid)) {
              // keep selected list for evidence ordering
            }
          }
        }
      }
      const t = apply({ type: "readsDone" });
      if (!t.ok) {
        return t;
      }
      continue;
    }

    if (state.phase === "ANSWER") {
      stage("answering");
      const ordered = orderEvidenceIds(selectedIds, allIds);
      const answerBudget = maxPromptTokens(args.numCtx, QA_NUM_PREDICT.answer);
      const rendered = ledger.renderForPrompt(
        ordered.length > 0 ? ordered : "all",
        answerBudget,
      );
      const prompt = buildAnswerPrompt(input.question, rendered.text, {
        ...(unknownForRetry !== undefined
          ? { unknownIds: unknownForRetry }
          : {}),
      });
      unknownForRetry = undefined;

      const answerResult = await ctx.step(
        `qa:answer:${state.modelCalls}:${state.verifyRetries}`,
        () =>
          args.model.generate<AnswerOutput>(
            {
              kind: "qa.answer",
              instructions: prompt.instructions,
              input: prompt.input,
              schema: answerOutputSchema,
              numPredict: QA_NUM_PREDICT.answer,
            },
            ctx.signal,
          ),
      );
      if (!answerResult.ok) {
        return err(answerResult.error);
      }
      modelCalls += 1;
      addUsage(answerResult.value.usage);
      lastAnswer = answerResult.value.value;
      claims = mapAnswerClaims(lastAnswer, ledger);

      const followup =
        lastAnswer.status === "insufficient" ? lastAnswer.followup : null;
      const t = apply({
        type: "answer",
        status: lastAnswer.status,
        followup,
      });
      if (!t.ok) {
        return t;
      }

      if (phaseOf(state) === "SEARCH" && followup != null) {
        followupPending = [
          {
            tool: "search_text",
            args: {
              terms:
                followup.terms.length > 0 ? followup.terms : ["followup"],
              phrases: followup.phrases,
            },
          },
        ];
        expandGraph = false;
      }
      continue;
    }

    if (state.phase === "VERIFY") {
      stage("verifying");
      if (lastAnswer === null) {
        return err(
          synapseError({
            code: "INTERNAL",
            message: "verify without answer",
          }),
        );
      }
      const unknownIds = collectUnknownSourceIds(lastAnswer, ledger);
      const t = apply({ type: "verify", unknownIds });
      if (!t.ok) {
        return t;
      }

      if (phaseOf(state) === "ANSWER") {
        // Retry once with feedback.
        unknownForRetry = unknownIds;
        continue;
      }

      // DONE — finalize citations
      if (unknownIds.length > 0) {
        claims = markUnknownClaimsUnverified(lastAnswer, claims, ledger);
      }
      claims = await attachAnchors(claims, args.readText);
      break;
    }

    // Unexpected phase
    return err(
      synapseError({
        code: "INTERNAL",
        message: `unexpected phase ${state.phase}`,
      }),
    );
  }

  return finish();
}

function checkAbort(ctx: JobContext): SynapseError | null {
  if (!ctx.signal.aborted) {
    return null;
  }
  return synapseError({
    code: "CANCELLED",
    message: "QaPipeline: aborted",
  });
}

function validatePlan(plan: PlanOutput): {
  searches: PlannedSearch[];
  expand_graph: boolean;
} {
  const searches: PlannedSearch[] = [];
  for (const s of plan.searches.slice(0, 4)) {
    const mapped = mapPlanSearch(s);
    if (mapped !== null) {
      searches.push(mapped);
    }
  }
  return { searches, expand_graph: plan.expand_graph };
}

function mapPlanSearch(
  s: PlanOutput["searches"][number],
): PlannedSearch | null {
  switch (s.tool) {
    case "search_text":
      if (s.terms.length < 1) {
        return null;
      }
      return {
        tool: "search_text",
        args: { terms: s.terms, phrases: s.phrases },
      };
    case "search_by_title": {
      const query = s.terms[0]?.trim() ?? "";
      if (query.length === 0) {
        return null;
      }
      return { tool: "search_by_title", args: { query } };
    }
    case "search_by_tag": {
      const tag = (s.tag ?? "").trim().replace(/^#/, "");
      if (tag.length === 0) {
        return null;
      }
      return { tool: "search_by_tag", args: { tag } };
    }
    case "list_recent": {
      if (s.days === null || !Number.isFinite(s.days) || s.days < 1) {
        return null;
      }
      return {
        tool: "list_recent",
        args: { by: "mtime", days: Math.floor(s.days) },
      };
    }
    default:
      return null;
  }
}

function sortSearches(searches: PlannedSearch[]): PlannedSearch[] {
  return [...searches].sort(
    (a, b) => SEARCH_ORDER.indexOf(a.tool) - SEARCH_ORDER.indexOf(b.tool),
  );
}

type HopInvokeArgs = {
  tools: ToolRegistry;
  dup: ReturnType<typeof createDuplicateTracker>;
  tool: ToolName;
  rawArgs: unknown;
  ctx: JobContext;
  emit: (e: QaEvent) => void;
  trace: TraceHop[];
  hopSerial: number;
  forceReject?: HopRejectReason;
};

async function recordHop(
  args: HopInvokeArgs & { forceReject: HopRejectReason },
): Promise<{ rejected: HopRejectReason; data?: unknown }> {
  const hop: TraceHop = {
    n: args.hopSerial,
    tool: args.tool,
    args: args.rawArgs,
    resultCount: 0,
    ms: 0,
    rejected: args.forceReject,
  };
  args.trace.push(hop);
  args.emit({ type: "hop", hop });
  return { rejected: args.forceReject };
}

async function invokeToolHop(
  args: HopInvokeArgs,
): Promise<{ rejected?: HopRejectReason; data?: unknown }> {
  const t0 = args.ctx.clock.mono();
  const key = args.tools.canonicalKey(args.tool, args.rawArgs);
  if (key === null) {
    const hop: TraceHop = {
      n: args.hopSerial,
      tool: args.tool,
      args: args.rawArgs,
      resultCount: 0,
      ms: args.ctx.clock.mono() - t0,
      rejected: "invalid_args",
    };
    args.trace.push(hop);
    args.emit({ type: "hop", hop });
    return { rejected: "invalid_args" };
  }
  const dupCheck = args.dup.check(key);
  if (!dupCheck.ok) {
    const hop: TraceHop = {
      n: args.hopSerial,
      tool: args.tool,
      args: args.rawArgs,
      resultCount: 0,
      ms: args.ctx.clock.mono() - t0,
      rejected: "duplicate",
    };
    args.trace.push(hop);
    args.emit({ type: "hop", hop });
    return { rejected: "duplicate" };
  }

  const outcome = await args.tools.invoke(args.tool, args.rawArgs, {
    signal: args.ctx.signal,
  });
  const ms = args.ctx.clock.mono() - t0;
  if (!outcome.ok) {
    const rejected: HopRejectReason =
      outcome.error.code === "TOOL_ARGS_INVALID"
        ? "invalid_args"
        : "invalid_args";
    // NOT_FOUND etc. still count as a hop without reject? DESIGN: invalid args
    // and duplicates. Tool errors: count hop, no reject tag, empty result.
    if (outcome.error.code === "TOOL_ARGS_INVALID") {
      const hop: TraceHop = {
        n: args.hopSerial,
        tool: args.tool,
        args: args.rawArgs,
        resultCount: 0,
        ms,
        rejected,
      };
      args.trace.push(hop);
      args.emit({ type: "hop", hop });
      return { rejected };
    }
    const hop: TraceHop = {
      n: args.hopSerial,
      tool: args.tool,
      args: args.rawArgs,
      resultCount: 0,
      ms,
    };
    args.trace.push(hop);
    args.emit({ type: "hop", hop });
    return {};
  }

  const resultCount = countResults(args.tool, outcome.data);
  const hop: TraceHop = {
    n: args.hopSerial,
    tool: args.tool,
    args: args.rawArgs,
    resultCount,
    ms,
  };
  args.trace.push(hop);
  args.emit({ type: "hop", hop });
  return { data: outcome.data };
}

function countResults(tool: ToolName, data: unknown): number {
  if (data === null || typeof data !== "object") {
    return 0;
  }
  const d = data as Record<string, unknown>;
  if (tool === "search_text" || tool === "search_by_title") {
    return Array.isArray(d.hits) ? d.hits.length : 0;
  }
  if (tool === "search_by_tag") {
    return Array.isArray(d.refs) ? d.refs.length : 0;
  }
  if (tool === "list_recent") {
    return Array.isArray(d.items) ? d.items.length : 0;
  }
  if (tool === "read_note") {
    return Array.isArray(d.excerpts) ? d.excerpts.length : 0;
  }
  if (tool === "get_links" || tool === "get_backlinks") {
    return Array.isArray(d.results) ? d.results.length : 0;
  }
  return 0;
}

function ingestSearchResult(
  tool: PlanSearchTool,
  data: unknown,
  ledger: EvidenceLedger,
  scored: ScoredCandidate[],
  allIds: ExcerptId[],
): void {
  if (tool === "search_text") {
    const result = data as SearchTextResult;
    for (const hit of result.hits) {
      for (const excerpt of hit.excerpts) {
        pushExcerpt(excerpt, hit.score, ledger, scored, allIds);
      }
    }
    return;
  }
  if (tool === "search_by_title") {
    const result = data as SearchByTitleResult;
    let score = result.hits.length;
    for (const hit of result.hits) {
      // Title hits lack excerpts — skip ledger mint (no text). Paths still
      // inform ranking only when excerpts exist; leave scored unchanged.
      void hit;
      void score;
      score -= 1;
    }
    return;
  }
  if (tool === "search_by_tag") {
    void (data as SearchByTagResult);
    return;
  }
  if (tool === "list_recent") {
    void (data as ListRecentResult);
    return;
  }
}

function pushExcerpt(
  excerpt: Excerpt,
  score: number,
  ledger: EvidenceLedger,
  scored: ScoredCandidate[],
  allIds: ExcerptId[],
): void {
  const id = ledger.add(excerpt);
  if (!allIds.includes(id)) {
    allIds.push(id);
  }
  const existing = scored.find((s) => s.id === id);
  if (existing) {
    if (score > existing.score) {
      existing.score = score;
    }
  } else {
    scored.push({ id, score, path: excerpt.ref.path });
  }
  scored.sort((a, b) => b.score - a.score);
}

function uniqueTopPaths(
  scored: ScoredCandidate[],
  n: number,
): VaultPath[] {
  const out: VaultPath[] = [];
  const seen = new Set<string>();
  for (const s of scored) {
    if (seen.has(s.path)) {
      continue;
    }
    seen.add(s.path);
    out.push(s.path);
    if (out.length >= n) {
      break;
    }
  }
  return out;
}
