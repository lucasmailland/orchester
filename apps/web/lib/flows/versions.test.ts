import { describe, it, expect } from "vitest";
import { versionSnapshot, restorePatch } from "./versions";

describe("flow versions carry the spec", () => {
  it("snapshots the spec with the graph", () => {
    expect(
      versionSnapshot({
        nodes: [{ id: "n" }],
        edges: null,
        variables: undefined,
        spec: "## Purpose",
      })
    ).toEqual({
      nodes: [{ id: "n" }],
      edges: [],
      variables: {},
      spec: "## Purpose",
    });
  });
  it("restores the spec with the graph, including a null spec", () => {
    expect(restorePatch({ nodes: [], edges: [], variables: { a: 1 }, spec: null })).toEqual({
      nodes: [],
      edges: [],
      variables: { a: 1 },
      spec: null,
    });
  });
});
