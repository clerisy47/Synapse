import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_IDS,
  COMMAND_NAMES,
  createM1Commands,
} from "./commands";

describe("createM1Commands", () => {
  it("exposes DESIGN §5.7 M1 command suffixes and wires handlers", async () => {
    const runHealthCheck = vi.fn();
    const cancelJob = vi.fn();
    const cmds = createM1Commands({ runHealthCheck, cancelJob });

    expect(cmds.map((c) => c.id)).toEqual([
      COMMAND_IDS.runHealthCheck,
      COMMAND_IDS.cancelJob,
    ]);
    expect(cmds[0]?.name).toBe(COMMAND_NAMES.runHealthCheck);
    expect(cmds[1]?.name).toBe(COMMAND_NAMES.cancelJob);

    await cmds[0]?.callback();
    expect(runHealthCheck).toHaveBeenCalledTimes(1);

    await cmds[1]?.callback();
    expect(cancelJob).toHaveBeenCalledTimes(1);
  });
});
