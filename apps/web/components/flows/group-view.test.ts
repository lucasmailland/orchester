import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  FRAME_HEADER,
  FRAME_PAD,
  groupIdOfViewNode,
  groupingProblem,
  projectGroups,
  type GroupViewData,
} from "./group-view";
import type { FlowGroup } from "@/lib/flows/groups";

const n = (id: string, type: string, x: number, y = 0): Node => ({
  id,
  type,
  position: { x, y },
  data: { label: `Step ${id}` },
});
const e = (source: string, target: string, sourceHandle?: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const sizeOf = () => ({ width: 200, height: 60 });

// t -> a -> b(condition) -true-> c -> d ; b -false-> d
const nodes = [
  n("t", "trigger", 0),
  n("a", "http", 100),
  n("b", "condition", 200, 40),
  n("c", "llm_prompt", 300),
  n("d", "transform", 400),
];
const edges = [e("t", "a"), e("a", "b"), e("b", "c", "true"), e("b", "d", "false"), e("c", "d")];
const group: FlowGroup = {
  id: "g1",
  name: "Fetch",
  description: "Fetch the case",
  icon: "Globe",
  nodeIds: ["a", "b", "c"],
};

const view = (over: Partial<Parameters<typeof projectGroups>[0]> = {}) =>
  projectGroups({ nodes, edges, groups: [group], expanded: new Set(), sizeOf, ...over });

describe("collapsed group", () => {
  it("replaces its steps with one block at their top-left corner", () => {
    const v = view();
    expect(v.nodes.map((x) => x.id)).toEqual(["t", "d", "group:g1"]);
    const block = v.nodes.find((x) => x.id === "group:g1")!;
    expect(block.type).toBe("flowGroup");
    expect(block.position).toEqual({ x: 100, y: 0 });
    expect(block.deletable).toBe(false);
    expect(block.data).toMatchObject({
      name: "Fetch",
      description: "Fetch the case",
      icon: "Globe",
      stepCount: 3,
      aiCount: 1,
      collapsed: true,
    });
  });

  it("draws entering and leaving edges to and from the block, hiding internal ones", () => {
    const v = view();
    expect(v.edges.map((x) => [x.source, x.target])).toEqual([
      ["t", "group:g1"],
      ["group:g1", "d"],
    ]);
    // b -false-> d and c -> d both leave the block towards d: drawn once.
    expect(v.edges.every((x) => x.sourceHandle === undefined)).toBe(true);
    expect(v.edges.every((x) => x.deletable === false)).toBe(true);
  });

  it("keeps the real handle on an edge that enters the block", () => {
    const v = projectGroups({
      nodes,
      edges,
      groups: [{ id: "g2", name: "Tail", nodeIds: ["c", "d"] }],
      expanded: new Set(),
      sizeOf,
    });
    expect(v.edges.find((x) => x.source === "b")?.sourceHandle).toBe("true");
  });

  it("connects two collapsed groups block to block", () => {
    const v = projectGroups({
      nodes,
      edges,
      groups: [
        { id: "g1", name: "A", nodeIds: ["t", "a"] },
        { id: "g2", name: "B", nodeIds: ["b", "c", "d"] },
      ],
      expanded: new Set(),
      sizeOf,
    });
    expect(v.edges.map((x) => [x.source, x.target])).toEqual([["group:g1", "group:g2"]]);
  });

  it("shows a failure inside, and which step failed", () => {
    const v = view({ runStatus: { a: "succeeded", b: "failed" } });
    const block = v.nodes.find((x) => x.id === "group:g1")!;
    expect(block.className).toBe("flow-node-fail");
    expect(block.data).toMatchObject({ status: "failed", failedStep: "Step b" });
  });

  it("aggregates running and succeeded", () => {
    const running = view({ runStatus: { a: "succeeded", b: "running" } });
    expect((running.nodes.at(-1)!.data as GroupViewData).status).toBe("running");
    const ok = view({ runStatus: { a: "succeeded", b: "succeeded" } });
    expect((ok.nodes.at(-1)!.data as GroupViewData).status).toBe("succeeded");
    expect((view().nodes.at(-1)!.data as GroupViewData).status).toBeUndefined();
  });

  it("counts the validation problems of the hidden steps", () => {
    const v = view({ issues: { a: ["x"], c: ["y", "z"], d: ["outside"] } });
    expect((v.nodes.at(-1)!.data as GroupViewData).issueCount).toBe(3);
  });
});

describe("expanded group", () => {
  it("draws the steps and a frame behind them", () => {
    const v = view({ expanded: new Set(["g1"]) });
    expect(v.nodes.map((x) => x.id)).toEqual(["frame:g1", "t", "a", "b", "c", "d"]);
    const frame = v.nodes[0]!;
    expect(frame.position).toEqual({ x: 100 - FRAME_PAD, y: -FRAME_PAD - FRAME_HEADER });
    expect(frame.style).toEqual({
      // c starts at x=300 and is 200 wide; a starts at x=100.
      width: 300 + 200 - 100 + FRAME_PAD * 2,
      height: 100 + FRAME_PAD * 2 + FRAME_HEADER,
    });
    expect(frame.selectable).toBe(false);
    expect(v.edges).toEqual(edges);
  });

  it("reveals the failed step with its own status", () => {
    const decorated = nodes.map((x) => (x.id === "b" ? { ...x, className: "flow-node-fail" } : x));
    const v = projectGroups({
      nodes: decorated,
      edges,
      groups: [group],
      expanded: new Set(["g1"]),
      runStatus: { b: "failed" },
      sizeOf,
    });
    expect(v.nodes.find((x) => x.id === "b")?.className).toBe("flow-node-fail");
    expect((v.nodes[0]!.data as GroupViewData).failedStep).toBe("Step b");
  });

  it("uses measured sizes when React Flow has them", () => {
    const measured = nodes.map((x) => ({ ...x, measured: { width: 100, height: 50 } }));
    const v = projectGroups({
      nodes: measured,
      edges,
      groups: [group],
      expanded: new Set(["g1"]),
      sizeOf,
    });
    expect(v.nodes[0]!.style).toMatchObject({ width: 300 - 100 + 100 + FRAME_PAD * 2 });
  });
});

describe("helpers", () => {
  it("maps view node ids back to groups", () => {
    expect(groupIdOfViewNode("group:g1")).toBe("g1");
    expect(groupIdOfViewNode("frame:g1")).toBe("g1");
    expect(groupIdOfViewNode("a")).toBeNull();
  });

  it("refuses to group fewer than two steps or steps that already have a group", () => {
    expect(groupingProblem([group], ["t"])).toBe("too_few");
    expect(groupingProblem([group], ["t", "a"])).toBe("already_grouped");
    expect(groupingProblem([group], ["t", "group:g1"])).toBe("already_grouped");
    expect(groupingProblem([group], ["t", "d"])).toBeNull();
  });
});
