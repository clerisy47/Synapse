import { expect, it, vi } from "vitest";
import { err, ok, synapseError, type Result } from "../core";
import { createResearchCaptureCommand, type ResearchCaptureRunner } from "./research-command";
import { RESEARCH } from "./strings/en";

it("reports captured and prior applied status using fixed strings", async () => {
  const capture = vi.fn<ResearchCaptureRunner["capture"]>().mockResolvedValueOnce(ok({ duplicate: false, outcome: "captured" })).mockResolvedValueOnce(ok({ duplicate: true, outcome: "applied" }));
  const service = { capture }; const notice = vi.fn(); const command = createResearchCaptureCommand({ service: () => service, notice });
  expect(command.id).toBe("capture-research-selection"); expect(command.name).toBe(RESEARCH.captureCommand);
  await command.callback(); await command.callback();
  expect(notice.mock.calls).toEqual([[RESEARCH.captured], [RESEARCH.duplicate("applied")]]);
});

it("redacts errors and suppresses cancellation and late disposed-service results", async () => {
  let resolve!: (value: Result<{ duplicate: boolean; outcome: "captured" }>) => void;
  let service: ResearchCaptureRunner | null = { capture: () => new Promise((done) => { resolve = done; }) };
  const notice = vi.fn(); const command = createResearchCaptureCommand({ service: () => service, notice });
  const pending = command.callback(); service = null; resolve(ok({ duplicate: false, outcome: "captured" })); await pending;
  expect(notice).not.toHaveBeenCalled();
  service = { capture: async () => err(synapseError({ code: "CANCELLED", message: "private" })) };
  await command.callback(); expect(notice).not.toHaveBeenCalled();
  service = { capture: async () => err(synapseError({ code: "STORAGE_WRITE_FAILED", message: "private API_KEY", detail: { issueCode: "RESEARCH_STORAGE_FAILED" } })) };
  await command.callback(); expect(notice).toHaveBeenLastCalledWith(RESEARCH.errors.RESEARCH_STORAGE_FAILED);
  service = { capture: async () => { throw new Error("research secret"); } };
  await command.callback(); expect(notice).toHaveBeenLastCalledWith(RESEARCH.unavailable);
  expect(JSON.stringify(notice.mock.calls)).not.toMatch(/private|API_KEY|secret/);
});
