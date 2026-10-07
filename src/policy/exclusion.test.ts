import { describe, expect, it } from "vitest";

import { asVaultPath } from "../core";
import { createExclusionPolicy } from "./index";

const FM_KEY = "vault-synapse";

function policy(
  overrides?: Partial<{
    folders: readonly string[];
    tags: readonly string[];
    frontmatterKey: string;
    frontmatterValue: string;
  }>,
) {
  return createExclusionPolicy({
    folders: overrides?.folders ?? [],
    tags: overrides?.tags ?? [],
    frontmatterKey: overrides?.frontmatterKey ?? FM_KEY,
    ...(overrides?.frontmatterValue !== undefined
      ? { frontmatterValue: overrides.frontmatterValue }
      : {}),
  });
}

describe("createExclusionPolicy folders", () => {
  it("excludes path under excluded folder and descendants", () => {
    const p = policy({ folders: ["Private"] });
    expect(
      p.decide(asVaultPath("Private/a.md"), [], {}),
    ).toBe("excluded");
    expect(
      p.decide(asVaultPath("Private/nested/b.md"), [], {}),
    ).toBe("excluded");
    expect(p.decide(asVaultPath("Private"), [], {})).toBe("excluded");
  });

  it("allows non-matching folder", () => {
    const p = policy({ folders: ["Private"] });
    expect(p.decide(asVaultPath("Notes/a.md"), [], {})).toBe("allowed");
    expect(p.decide(asVaultPath("Privateish/a.md"), [], {})).toBe("allowed");
  });
});

describe("createExclusionPolicy tags", () => {
  it("excludes exact tag match", () => {
    const p = policy({ tags: ["private"] });
    expect(p.decide(asVaultPath("n.md"), ["private"], {})).toBe("excluded");
  });

  it("excludes nested tag children", () => {
    const p = policy({ tags: ["private"] });
    expect(p.decide(asVaultPath("n.md"), ["private/x"], {})).toBe("excluded");
  });

  it("does not exclude sibling-prefix tags", () => {
    const p = policy({ tags: ["private"] });
    expect(p.decide(asVaultPath("n.md"), ["privateish"], {})).toBe("allowed");
  });
});

describe("createExclusionPolicy frontmatter", () => {
  it("excludes when key is ignore (case-insensitive)", () => {
    const p = policy();
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": "ignore" }),
    ).toBe("excluded");
    expect(
      p.decide(asVaultPath("n.md"), [], { "Vault-Synapse": "IGNORE" }),
    ).toBe("excluded");
  });

  it("does not exclude other frontmatter values", () => {
    const p = policy();
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": "keep" }),
    ).toBe("allowed");
  });
});

describe("createExclusionPolicy fail-closed", () => {
  it("excludes when tags or frontmatter are null", () => {
    const p = policy();
    expect(p.decide(asVaultPath("n.md"), null, {})).toBe("excluded");
    expect(p.decide(asVaultPath("n.md"), [], null)).toBe("excluded");
    expect(p.decide(asVaultPath("n.md"), null, null)).toBe("excluded");
  });
});

describe("createExclusionPolicy PDF (F-22)", () => {
  it("excludes PDF by folder only; ignores tag and frontmatter", () => {
    const p = policy({
      folders: ["Papers"],
      tags: ["secret"],
    });
    expect(
      p.decide(asVaultPath("Papers/x.pdf"), ["secret"], {
        "vault-synapse": "ignore",
      }, { kind: "pdf" }),
    ).toBe("excluded");

    expect(
      p.decide(asVaultPath("Other/x.pdf"), ["secret"], {
        "vault-synapse": "ignore",
      }, { kind: "pdf" }),
    ).toBe("allowed");
  });
});
