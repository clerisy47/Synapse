import { describe, expect, it } from "vitest";

import { asVaultPath, type VaultPath } from "../core";
import { FakeVault } from "../../test/fakes";
import { createExclusionPolicy, type ExclusionPolicy } from "./index";

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

/** Seeded metadata for ingest simulation; missing key → null (fail-closed). */
type MetaEntry = {
  tags: readonly string[] | null;
  frontmatter: Record<string, unknown> | null;
};

async function ingestDecisions(
  vault: FakeVault,
  meta: Map<string, MetaEntry>,
  excl: ExclusionPolicy,
): Promise<{ allowed: Set<string>; excluded: Set<string> }> {
  const allowed = new Set<string>();
  const excluded = new Set<string>();
  for (const file of await vault.listFiles()) {
    const entry = meta.get(file.path);
    const tags = entry?.tags ?? null;
    const frontmatter = entry?.frontmatter ?? null;
    const decision = excl.decide(file.path, tags, frontmatter, {
      kind: file.kind,
    });
    if (decision === "allowed") {
      allowed.add(file.path);
    } else {
      excluded.add(file.path);
    }
  }
  return { allowed, excluded };
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

  it("normalizes leading/trailing slashes and backslashes on folder rules", () => {
    const p = policy({ folders: ["/Private/", "Archive\\Deep"] });
    expect(p.decide(asVaultPath("Private/a.md"), [], {})).toBe("excluded");
    expect(p.decide(asVaultPath("Archive/Deep/x.md"), [], {})).toBe("excluded");
  });

  it("ignores empty folder rules", () => {
    const p = policy({ folders: [""] });
    expect(p.decide(asVaultPath("Private/a.md"), [], {})).toBe("allowed");
  });

  it("excludes when any of multiple folder rules match", () => {
    const p = policy({ folders: ["A", "B"] });
    expect(p.decide(asVaultPath("A/x.md"), [], {})).toBe("excluded");
    expect(p.decide(asVaultPath("B/y.md"), [], {})).toBe("excluded");
    expect(p.decide(asVaultPath("C/z.md"), [], {})).toBe("allowed");
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

  it("strips leading # on tags and rules", () => {
    const p = policy({ tags: ["#private"] });
    expect(p.decide(asVaultPath("n.md"), ["#private"], {})).toBe("excluded");
    expect(p.decide(asVaultPath("n.md"), ["private"], {})).toBe("excluded");
  });

  it("ignores empty tag rules", () => {
    const p = policy({ tags: [""] });
    expect(p.decide(asVaultPath("n.md"), ["private"], {})).toBe("allowed");
  });

  it("excludes when any of multiple tag rules match", () => {
    const p = policy({ tags: ["a", "b"] });
    expect(p.decide(asVaultPath("n.md"), ["b"], {})).toBe("excluded");
    expect(p.decide(asVaultPath("n.md"), ["c"], {})).toBe("allowed");
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

  it("does not exclude non-string frontmatter values", () => {
    const p = policy();
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": true }),
    ).toBe("allowed");
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": 1 }),
    ).toBe("allowed");
  });

  it("respects custom frontmatterValue", () => {
    const p = policy({ frontmatterValue: "skip" });
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": "skip" }),
    ).toBe("excluded");
    expect(
      p.decide(asVaultPath("n.md"), [], { "vault-synapse": "ignore" }),
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

  it("excludes unparsed notes even with no folder or tag rules", () => {
    const p = policy({ folders: [], tags: [] });
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

  it("allows PDF with null tags/frontmatter outside excluded folders", () => {
    const p = policy({ folders: ["Papers"], tags: ["secret"] });
    expect(
      p.decide(asVaultPath("Other/x.pdf"), null, null, { kind: "pdf" }),
    ).toBe("allowed");
  });
});

describe("exclusion ingest gate (FakeVault integration, DESIGN §6.6 / R6)", () => {
  it("partitions vault files by folder/tag/frontmatter/unparsed/PDF rules", async () => {
    const vault = new FakeVault();
    vault.addNote({ path: "Notes/ok.md", text: "ok" });
    vault.addNote({ path: "Private/secret.md", text: "no" });
    vault.addNote({ path: "Notes/tagged.md", text: "tag" });
    vault.addNote({ path: "Notes/ignored.md", text: "fm" });
    vault.addNote({ path: "Notes/unparsed.md", text: "wait" });
    vault.addPdf({ path: "Papers/a.pdf" });
    vault.addPdf({ path: "Other/b.pdf" });

    const meta = new Map<string, MetaEntry>([
      ["Notes/ok.md", { tags: [], frontmatter: {} }],
      ["Private/secret.md", { tags: [], frontmatter: {} }],
      ["Notes/tagged.md", { tags: ["private"], frontmatter: {} }],
      [
        "Notes/ignored.md",
        { tags: [], frontmatter: { "vault-synapse": "ignore" } },
      ],
      // Notes/unparsed.md intentionally absent → null fail-closed
      ["Papers/a.pdf", { tags: ["secret"], frontmatter: { "vault-synapse": "ignore" } }],
      ["Other/b.pdf", { tags: null, frontmatter: null }],
    ]);

    const excl = policy({
      folders: ["Private", "Papers"],
      tags: ["private"],
    });

    const { allowed, excluded } = await ingestDecisions(vault, meta, excl);

    expect([...allowed].sort()).toEqual(["Notes/ok.md", "Other/b.pdf"]);
    expect([...excluded].sort()).toEqual([
      "Notes/ignored.md",
      "Notes/tagged.md",
      "Notes/unparsed.md",
      "Papers/a.pdf",
      "Private/secret.md",
    ]);

    for (const path of allowed) {
      expect(excluded.has(path)).toBe(false);
    }
    expect(excluded.has("Notes/unparsed.md")).toBe(true);
  });

  it("never places the same path in both allowed and excluded sets", async () => {
    const vault = new FakeVault();
    const paths: VaultPath[] = [];
    for (const p of ["a.md", "Private/b.md", "c.md"]) {
      paths.push(vault.addNote({ path: p, text: "" }));
    }
    vault.addPdf({ path: "Private/d.pdf" });
    vault.addPdf({ path: "e.pdf" });

    const meta = new Map<string, MetaEntry>([
      ["a.md", { tags: [], frontmatter: {} }],
      ["Private/b.md", { tags: [], frontmatter: {} }],
      ["c.md", { tags: null, frontmatter: null }],
      ["Private/d.pdf", { tags: null, frontmatter: null }],
      ["e.pdf", { tags: ["x"], frontmatter: {} }],
    ]);

    const { allowed, excluded } = await ingestDecisions(
      vault,
      meta,
      policy({ folders: ["Private"], tags: [] }),
    );

    const intersection = [...allowed].filter((p) => excluded.has(p));
    expect(intersection).toEqual([]);
    expect(allowed.size + excluded.size).toBe((await vault.listFiles()).length);
  });
});
