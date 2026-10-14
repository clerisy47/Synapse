import { expect, it, vi } from "vitest";
import { asVaultPath } from "../core";
import { guardNavigation } from "./navigation";
import type { ReadSession } from "./read-session";

it("checks fresh authority for each citation open and never forwards denied targets", async () => {
  let ready = true;
  const navigation = { openAt: vi.fn(async () => {}) };
  const access: ReadSession = { version: "v1", current: () => ready, allows: () => ready, remember: () => {}, project: () => null, sanitize: (text) => text };
  const guarded = guardNavigation(navigation, () => access);
  const target = { path: asVaultPath("Public.md") };
  await guarded.openAt(target);
  expect(navigation.openAt).toHaveBeenCalledExactlyOnceWith(target);
  ready = false;
  await guarded.openAt(target);
  expect(navigation.openAt).toHaveBeenCalledTimes(1);
  await guardNavigation(navigation, () => null).openAt(target);
  expect(navigation.openAt).toHaveBeenCalledTimes(1);
});
