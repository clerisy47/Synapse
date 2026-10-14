import type { ResearchProcessingState, Result } from "../core";
import type { CommandDef } from "./commands";
import { RESEARCH } from "./strings/en";

export interface ResearchCaptureRunner {
  capture(): Promise<Result<{ readonly duplicate: boolean; readonly outcome: ResearchProcessingState }>>;
}

/** Pure command shell; late results from a disposed/rebuilt service cannot display notices. */
export function createResearchCaptureCommand(deps: {
  service: () => ResearchCaptureRunner | null;
  notice: (message: string) => void;
}): CommandDef {
  return {
    id: "capture-research-selection", name: RESEARCH.captureCommand,
    async callback() {
      const service = deps.service();
      if (!service) return;
      try {
        const result = await service.capture();
        if (deps.service() !== service) return;
        if (result.ok) deps.notice(result.value.duplicate ? RESEARCH.duplicate(result.value.outcome) : RESEARCH.captured);
        else if (result.error.code !== "CANCELLED") {
          const issue = result.error.detail?.issueCode;
          deps.notice(typeof issue === "string" ? RESEARCH.errors[issue] ?? RESEARCH.unavailable : RESEARCH.unavailable);
        }
      } catch {
        if (deps.service() === service) deps.notice(RESEARCH.unavailable);
      }
    },
  };
}
