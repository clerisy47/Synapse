// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { err, ok, synapseError } from "../core";
import { createRecoveryCommand } from "./recovery-command";
import { RECOVERY } from "./strings/en";

it("shows reconciled ordered outcomes and retention disclosure without persisted paths or Markdown", async () => {
  const el = document.createElement("div"); const session = vi.fn(() => null); const notice = vi.fn();
  const command = createRecoveryCommand({ records: async () => ok([{ id: "a".repeat(64), outcomes: ["applied", "conflicted", "not-attempted"] }]), session, notice,
    open: (mount, close) => mount(el, close) });
  await command.initialize(); expect(notice).toHaveBeenCalledWith(RECOVERY.pending);
  await command.command.callback();
  expect(el.textContent).toContain(RECOVERY.disclosure); expect(el.textContent).toContain("applied, conflicted, not-attempted");
  el.querySelector("button")!.click(); expect(session).toHaveBeenCalledWith("a".repeat(64));
  command.dispose(); expect(el.textContent).toBe("");
});
it("fails closed on inaccessible journal and suppresses late results after unload", async () => {
  const notice = vi.fn(); const open = vi.fn(); const session = vi.fn(() => null);
  const command = createRecoveryCommand({ records: async () => err(synapseError({ code: "STORAGE_WRITE_FAILED", message: "Recovery unavailable" })), session, notice, open });
  await command.command.callback(); expect(open).not.toHaveBeenCalled(); expect(notice).toHaveBeenCalledWith(RECOVERY.unavailable);
  command.dispose();
  let release!: (value: ReturnType<typeof ok<readonly { id: string; outcomes: string[] }[]>>) => void;
  const pending = new Promise<ReturnType<typeof ok<readonly { id: string; outcomes: string[] }[]>>>((resolve) => { release = resolve; });
  const delayed = createRecoveryCommand({ records: () => pending, session, notice, open });
  const running = delayed.command.callback(); delayed.dispose(); release(ok([])); await running;
  expect(open).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
});
