import { describe, expect, it } from "vitest";
import { metadataIssues, parseNoteFrontmatter, proposeMissingMetadata, NOTE_METADATA_LIMITS } from "./index";
const valid = { description: "Trees and their training scope.", tags: ["machine-learning"], aliases: [] };
describe("mandatory note metadata", () => {
  it("requires explicit lists and bounded nonempty strings, allowing empty aliases", () => {
    expect(metadataIssues(valid)).toEqual([]);
    for (const field of ["description", "tags", "aliases"] as const) {
      const missing: Record<string, unknown> = { ...valid }; delete missing[field];
      expect(metadataIssues(missing)).toContainEqual({ field, reason: "missing" });
      for (const value of [null, 1, {}, "", [""], ["  "], [3]]) {
        expect(metadataIssues({ ...valid, [field]: value })).toContainEqual({ field, reason: "invalid" });
      }
    }
    expect(metadataIssues({ ...valid, tags: [] })).toHaveLength(1);
    expect(metadataIssues({ ...valid, description: "x".repeat(NOTE_METADATA_LIMITS.description + 1) })).toHaveLength(1);
    expect(metadataIssues({ ...valid, aliases: Array(13).fill("useful") })).toHaveLength(1);
  });
  it("rejects malformed YAML, duplicate keys, unterminated fences and excessive expansion", () => {
    for (const text of ["---\ntags: [\n---\nbody", "---\ndescription: x\ndescription: y\n---\n", "---\ntags: [x]", "---\n- not a mapping\n---\n"]) expect(parseNoteFrontmatter(text).issues).toContainEqual({ field: "frontmatter", reason: "invalid" });
  });
  it("adds only absent keys, preserving existing metadata, comments, CRLF and every body byte", () => {
    const before = '\uFEFF---\r\ndescription: Existing subject. # preserve\r\ncustom: &value [one, two]\r\ncopy: *value\r\n---\r\n# Body\r\nOriginal text.\r\n';
    const after = proposeMissingMetadata(before, valid)!;
    expect(after).toBe(before.replace('---\r\n# Body', 'tags: ["machine-learning"]\r\naliases: []\r\n---\r\n# Body'));
    expect(parseNoteFrontmatter(after).issues).toEqual([]);
    expect(proposeMissingMetadata(after, valid)).toBeNull();
    expect(proposeMissingMetadata('---\ndescription: ""\n---\nbody', valid)).toBeNull();
  });
  it("handles absent or empty frontmatter without inventing aliases", () => {
    for (const before of ["# Note\nBody", "---\n---\n# Note\nBody"]) {
      const after = proposeMissingMetadata(before, valid)!;
      expect(parseNoteFrontmatter(after).value).toMatchObject(valid);
      expect(after.endsWith("# Note\nBody")).toBe(true);
    }
  });
});
