import { describe, it, expect } from "vitest";
import { computeGraphAnalytics } from "./graph-analytics";

describe("computeGraphAnalytics adjacency", () => {
  it("returns degree and neighbours per node", () => {
    const a = computeGraphAnalytics(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ]
    );
    expect(a.degreeById.get("b")).toBe(2);
    expect(a.degreeById.get("a")).toBe(1);
    expect([...(a.neighborsById.get("b") ?? [])].sort()).toEqual(["a", "c"]);
  });
});
