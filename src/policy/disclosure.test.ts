import { describe, expect, it } from "vitest";
import { asVaultPath, type MaskAction } from "../core";
import { FakeCorpus } from "../../test/fakes";
import { projectDisclosure, replaceLiterals } from "./disclosure";

const corpus = new FakeCorpus([{ path: "Private/Secret.md", title: "Secret", text: "", tags: ["hidden"], aliases: ["Alias"] }]);
const doc = corpus.asDeps().getDoc(asVaultPath("Private/Secret.md"))!;
const source = '---\nowner: Alice\ntags: hidden\n---\n# Secret\nPrivate/Secret.md Alias #hidden secret token';
const excerpt = { ref: doc.ref, text: source, locator: { start: 0, end: source.length, heading: "Secret" }, textHash: "private", sourceMtime: 1 };

describe("disclosure projection", () => {
  it("unions field removals, strips frontmatter and known values without mutating source", () => {
    const masks: MaskAction[] = ["path", "title", "tags", "aliases", "frontmatter"].map((field) => ({ kind: "remove-field", field: field as Extract<MaskAction, { kind: "remove-field" }>["field"] }));
    const view = projectDisclosure(excerpt, doc, { owner: "Alice", tags: "hidden" }, source, masks);
    expect(view.title).toBe("");
    expect(view.text).not.toMatch(/Alice|Secret|Private|Alias|hidden|owner:/);
    expect(view).not.toHaveProperty("ref");
    expect(excerpt.text).toBe(source);
  });
  it("removes frontmatter even when the excerpt starts inside it", () => {
    const partial = { ...excerpt, text: source.slice(8, 30), locator: { start: 8, end: 30 } };
    expect(projectDisclosure(partial, doc, {}, source, [{ kind: "remove-field", field: "frontmatter" }]).text).toBe("");
  });
  it("applies literal actions once in declared order, with case sensitivity and no regex", () => {
    expect(replaceLiterals("a.b a.b A.B", [{ kind: "replace-literal", from: "a.b", to: "x" }, { kind: "replace-literal", from: "x", to: "xx" }])).toBe("xx xx A.B");
  });
});
