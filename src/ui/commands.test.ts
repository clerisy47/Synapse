import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_IDS,
  COMMAND_NAMES,
  createM1Commands,
  createM2Commands,
  createM3Commands,
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

describe("createM2Commands", () => {
  it("adds debug list_recent when handler provided", async () => {
    const debugListRecent = vi.fn();
    const cmds = createM2Commands({
      runHealthCheck: vi.fn(),
      cancelJob: vi.fn(),
      debugListRecent,
    });
    expect(cmds.map((c) => c.id)).toContain(COMMAND_IDS.debugListRecent);
    const debug = cmds.find((c) => c.id === COMMAND_IDS.debugListRecent);
    await debug?.callback();
    expect(debugListRecent).toHaveBeenCalledTimes(1);
  });
});

it("registers open-chat with the injected sidebar handler", async () => {
  const openChat = vi.fn();
  const cmds = createM3Commands({ runHealthCheck: vi.fn(), cancelJob: vi.fn(), openChat });
  const chat = cmds.find((c) => c.id === "open-chat");
  expect(chat?.name).toBe("Open Synapse chat");
  await chat?.callback();
  expect(openChat).toHaveBeenCalledOnce();
});
