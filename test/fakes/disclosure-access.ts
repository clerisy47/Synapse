import type { Excerpt } from "../../src/core";

/** Explicit allow-all boundary for synthetic orchestration fixtures only. */
export function fixtureDisclosureAccess() {
  return {
    version: "fixture", current: () => true, sanitize: (text: string) => text,
    project(excerpt: Excerpt) {
      const basename = excerpt.ref.path.split("/").pop() ?? "";
      return { title: basename.replace(/\.md$/, ""), text: excerpt.text,
        ...(excerpt.locator.heading ? { heading: excerpt.locator.heading } : {}) };
    },
  };
}
