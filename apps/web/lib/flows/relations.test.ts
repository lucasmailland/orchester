import { describe, it, expect } from "vitest";
import { computeFlowRelations, relationCounts } from "./relations";

const call = (id: string, flowId: string, label = id, type = "subflow") => ({
  id,
  type,
  label,
  config: { flowId },
});
const ai = { id: "ai1", type: "llm_prompt", label: "Ask", config: {} };

const flow = (id: string, nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name: `Flow ${id}`,
  nodes,
  ...extra,
});

describe("computeFlowRelations", () => {
  it("links callers and callees in both directions, in step order", () => {
    const rel = computeFlowRelations(
      [
        flow("a", [call("s1", "c"), call("s2", "b", "Second")]),
        flow("b", [ai], { kind: "action" }),
        flow("c", [], { kind: "action" }),
      ],
      {}
    );
    expect(rel.a!.uses.map((u) => u.flowId)).toEqual(["c", "b"]);
    expect(rel.a!.uses[1]).toMatchObject({
      name: "Flow b",
      kind: "action",
      ai: true,
      missing: false,
    });
    expect(rel.a!.uses[0]).toMatchObject({ ai: false });
    expect(rel.b!.usedBy).toEqual([
      {
        flowId: "a",
        name: "Flow a",
        kind: "pipeline",
        ai: false,
        missing: false,
        steps: ["Second"],
      },
    ]);
    expect(rel.c!.usedBy.map((u) => u.flowId)).toEqual(["a"]);
  });

  it("reports a missing target without inventing a name", () => {
    const rel = computeFlowRelations([flow("a", [call("s", "gone")])], {});
    expect(rel.a!.uses).toEqual([
      { flowId: "gone", name: null, kind: null, ai: false, missing: true, steps: ["s"] },
    ]);
  });

  it("ignores self references and steps with no target", () => {
    const rel = computeFlowRelations([flow("a", [call("s", "a"), call("t", "")])], {});
    expect(rel.a!.uses).toEqual([]);
    expect(rel.a!.usedBy).toEqual([]);
  });

  it("counts a flow called twice once and lists both step labels", () => {
    const rel = computeFlowRelations(
      [flow("a", [call("s1", "b", "First"), call("s2", "b", "Again")]), flow("b", [])],
      {}
    );
    expect(rel.a!.uses).toHaveLength(1);
    expect(rel.a!.uses[0]!.steps).toEqual(["First", "Again"]);
    expect(rel.b!.usedBy).toHaveLength(1);
    expect(rel.b!.usedBy[0]!.steps).toEqual(["First", "Again"]);
  });

  it("terminates on cycles and still marks AI reached through them", () => {
    const rel = computeFlowRelations(
      [flow("a", [call("s", "b")]), flow("b", [call("t", "a"), ai])],
      {}
    );
    expect(rel.a!.uses[0]).toMatchObject({ flowId: "b", ai: true });
    expect(rel.b!.uses[0]).toMatchObject({ flowId: "a", ai: true });
  });

  it("marks a callee that reaches AI only through its own subflow", () => {
    const rel = computeFlowRelations(
      [flow("a", [call("s", "b")]), flow("b", [call("t", "c")]), flow("c", [ai])],
      {}
    );
    expect(rel.a!.uses[0]!.ai).toBe(true);
  });

  it("carries external callers and trigger counts", () => {
    const rel = computeFlowRelations(
      [flow("a", [], { externalCallers: [{ name: "script", note: "nightly" }] })],
      { a: { webhooks: 2, schedules: 1 } }
    );
    expect(rel.a!.externalCallers).toEqual([{ name: "script", note: "nightly" }]);
    expect(rel.a!.webhooks).toBe(2);
    expect(rel.a!.schedules).toBe(1);
    expect(relationCounts(rel.a!)).toEqual({ usedBy: 4, uses: 0 });
  });

  it("tolerates malformed stored graphs", () => {
    const rel = computeFlowRelations(
      [flow("a", null as unknown as unknown[]), flow("b", "x" as unknown as unknown[])],
      {}
    );
    expect(rel.a!.uses).toEqual([]);
    expect(rel.b!.usedBy).toEqual([]);
  });

  it("marks a caller with AI only when it has AI steps of its own", () => {
    const rel = computeFlowRelations(
      [flow("a", [call("s", "b"), ai]), flow("p", [call("s", "a")]), flow("b", [ai])],
      {}
    );
    expect(rel.b!.usedBy.find((l) => l.flowId === "a")!.ai).toBe(true);
    // p reaches AI only through a, not by itself.
    expect(rel.a!.usedBy.find((l) => l.flowId === "p")!.ai).toBe(false);
  });
});
