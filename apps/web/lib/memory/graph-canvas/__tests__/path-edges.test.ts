// apps/web/lib/memory/graph-canvas/__tests__/path-edges.test.ts
import { describe, it, expect } from "vitest";
import { edgeKey, endId, keyForEdge, pathEdgeKeySet, pathNodeIdSet } from "../path-edges";

describe("edgeKey", () => {
  it("is order-independent", () => {
    expect(edgeKey("A", "B")).toBe(edgeKey("B", "A"));
  });
  it("distinguishes different pairs", () => {
    expect(edgeKey("A", "B")).not.toBe(edgeKey("A", "C"));
  });
});

describe("endId", () => {
  it("reads string ends as-is", () => {
    expect(endId("ment_x")).toBe("ment_x");
  });
  it("reads object ends via .id", () => {
    expect(endId({ id: "ment_y" })).toBe("ment_y");
  });
  it("returns empty string for null/undefined", () => {
    expect(endId(null)).toBe("");
    expect(endId(undefined)).toBe("");
  });
});

describe("keyForEdge", () => {
  it("matches the key from raw ids regardless of end shape", () => {
    expect(keyForEdge({ id: "A" }, "B")).toBe(edgeKey("A", "B"));
    expect(keyForEdge("B", { id: "A" })).toBe(edgeKey("A", "B"));
  });
});

describe("pathEdgeKeySet", () => {
  it("derives keys from consecutive path pairs", () => {
    const set = pathEdgeKeySet({ path: ["A", "B", "C"] });
    expect(set.has(edgeKey("A", "B"))).toBe(true);
    expect(set.has(edgeKey("B", "C"))).toBe(true);
    expect(set.has(edgeKey("A", "C"))).toBe(false);
    expect(set.size).toBe(2);
  });
  it("unions in keys from the edges array (undirected)", () => {
    const set = pathEdgeKeySet({ path: ["A", "B"], edges: [{ source: "B", target: "A" }] });
    // path pair and the reversed edge collapse to the same key
    expect(set.size).toBe(1);
    expect(set.has(edgeKey("A", "B"))).toBe(true);
  });
  it("is empty for a zero- or one-node path with no edges", () => {
    expect(pathEdgeKeySet({ path: [] }).size).toBe(0);
    expect(pathEdgeKeySet({ path: ["A"] }).size).toBe(0);
    expect(pathEdgeKeySet({}).size).toBe(0);
  });
});

describe("pathNodeIdSet", () => {
  it("collects the path node ids", () => {
    const set = pathNodeIdSet(["A", "B", "C"]);
    expect([...set].sort()).toEqual(["A", "B", "C"]);
  });
  it("is empty for null/empty", () => {
    expect(pathNodeIdSet(null).size).toBe(0);
    expect(pathNodeIdSet([]).size).toBe(0);
  });
});
