/**
 * LinkGraph from synthetic resolvedLinks (M2-T04 / ADR-07 / OQ-11).
 */

import { describe, expect, it } from "vitest";
import { asVaultPath } from "../core";
import { FakeMetadata } from "../../test/fakes";
import { createLinkGraph } from "./link-graph";

const A = asVaultPath("notes/a.md");
const B = asVaultPath("notes/b.md");
const C = asVaultPath("notes/c.md");
const EX = asVaultPath("private/secret.md");
const PDF = asVaultPath("docs/spec.pdf");

function allowed(...paths: string[]): Set<string> {
  return new Set(paths.map((p) => asVaultPath(p)));
}

describe("LinkGraph", () => {
  it("rebuilds forward and inverse from resolvedLinks", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [B]: 1, [C]: 2 },
        [B]: { [C]: 1 },
      },
      allowed(A, B, C),
    );

    expect(g.outgoing(A)).toEqual([B, C]);
    expect(g.outgoing(B)).toEqual([C]);
    expect(g.outgoing(C)).toEqual([]);
    expect(g.incoming(A)).toEqual([]);
    expect(g.incoming(B)).toEqual([A]);
    expect(g.incoming(C)).toEqual([A, B]);
  });

  it("drops excluded targets (treated as unresolved)", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [B]: 1, [EX]: 3 },
      },
      allowed(A, B),
    );

    expect(g.outgoing(A)).toEqual([B]);
    expect(g.incoming(EX)).toEqual([]);
    expect(g.outgoing(EX)).toEqual([]);
  });

  it("drops edges from excluded sources", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [EX]: { [A]: 1, [B]: 1 },
        [A]: { [B]: 1 },
      },
      allowed(A, B),
    );

    expect(g.outgoing(EX)).toEqual([]);
    expect(g.incoming(A)).toEqual([]);
    expect(g.outgoing(A)).toEqual([B]);
    expect(g.incoming(B)).toEqual([A]);
  });

  it("ignores zero counts and missing paths", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [B]: 0, [C]: 1 },
      },
      allowed(A, B, C),
    );

    expect(g.outgoing(A)).toEqual([C]);
    expect(g.incoming(B)).toEqual([]);
    expect(g.outgoing(asVaultPath("missing.md"))).toEqual([]);
    expect(g.incoming(asVaultPath("missing.md"))).toEqual([]);
  });

  it("includes allowed PDF targets (notes → PDFs)", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [PDF]: 1 },
      },
      allowed(A, PDF),
    );

    expect(g.outgoing(A)).toEqual([PDF]);
    expect(g.incoming(PDF)).toEqual([A]);
  });

  it("updateSource replaces outbound and repairs inverse", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [B]: 1, [C]: 1 },
        [B]: { [C]: 1 },
      },
      allowed(A, B, C),
    );

    g.updateSource(A, { [B]: 1 }, allowed(A, B, C));
    expect(g.outgoing(A)).toEqual([B]);
    expect(g.incoming(C)).toEqual([B]);
    expect(g.incoming(B)).toEqual([A]);

    g.updateSource(A, null, allowed(A, B, C));
    expect(g.outgoing(A)).toEqual([]);
    expect(g.incoming(B)).toEqual([]);
  });

  it("remove purges path as source and target", () => {
    const g = createLinkGraph();
    g.rebuild(
      {
        [A]: { [B]: 1, [C]: 1 },
        [B]: { [C]: 1 },
      },
      allowed(A, B, C),
    );

    g.remove(B);
    expect(g.outgoing(B)).toEqual([]);
    expect(g.incoming(B)).toEqual([]);
    expect(g.outgoing(A)).toEqual([C]);
    expect(g.incoming(C)).toEqual([A]);
  });

  it("clear empties both maps", () => {
    const g = createLinkGraph();
    g.rebuild({ [A]: { [B]: 1 } }, allowed(A, B));
    g.clear();
    expect(g.outgoing(A)).toEqual([]);
    expect(g.incoming(B)).toEqual([]);
  });

  it("works with FakeMetadata.resolvedLinks", () => {
    const meta = new FakeMetadata();
    meta.setResolvedLinks({
      [A]: { [B]: 1 },
      [B]: { [C]: 1 },
    });
    const g = createLinkGraph();
    g.rebuild(meta.resolvedLinks(), allowed(A, B, C));
    expect(g.outgoing(A)).toEqual([B]);
    expect(g.incoming(C)).toEqual([B]);
  });
});
