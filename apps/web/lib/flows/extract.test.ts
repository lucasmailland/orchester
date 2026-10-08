import { describe, it, expect } from "vitest";
import { buildExtraction, extractionSpec, planExtraction, type ExtractionPlan } from "./extract";
import { validateStoredFlow } from "./validate-stored";

const n = (id: string, type: string, config: Record<string, unknown> = {}, x = 0, y = 0) => ({
  id,
  type,
  label: id,
  config,
  position: { x, y },
});
const e = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const trigger = n("t", "trigger", { triggerKind: "manual" });
const tf = (id: string, template: Record<string, unknown>) => n(id, "transform", { template });
const call = (id: string, action: string, input: Record<string, unknown>, outputVar?: string) =>
  n(id, "integration", {
    integrationId: `crm::${action}`,
    input,
    ...(outputVar ? { outputVar } : {}),
  });

function planOf(nodes: unknown[], edges: unknown[], nodeIds: string[], groups?: unknown) {
  return planExtraction({ nodes, edges, ...(groups ? { groups } : {}) }, { nodeIds });
}
function okPlan(nodes: unknown[], edges: unknown[], nodeIds: string[]): ExtractionPlan {
  const r = planOf(nodes, edges, nodeIds);
  if (!r.ok) throw new Error(`expected a plan, got ${JSON.stringify(r.blocks)}`);
  return r.plan;
}
const codes = (r: ReturnType<typeof planExtraction>) =>
  r.ok ? [] : r.blocks.map((b) => b.code).sort();

// t -> a -> b -> c -> d
const linear = {
  nodes: [
    trigger,
    call("a", "get_case", { id: "{{caseId}}" }, "theCase"),
    tf("b", { priority: "{{theCase.priority}}", scratch: "x" }),
    tf("c", { summary: "case {{caseId}} is {{priority}}" }),
    call("d", "post_note", { text: "{{summary}} / {{priority}}" }),
  ],
  edges: [e("t", "a"), e("a", "b"), e("b", "c"), e("c", "d")],
};

describe("which blocks can be extracted", () => {
  it("accepts a linear block with one way in and one way out", () => {
    const plan = okPlan(linear.nodes, linear.edges, ["b", "c"]);
    expect(plan).toMatchObject({
      nodeIds: ["b", "c"],
      entryNodeId: "b",
      exitNodeId: "c",
      entryEdgeId: "a-b",
      exitEdgeId: "c-d",
    });
  });

  it("refuses a block that holds the trigger", () => {
    expect(codes(planOf(linear.nodes, linear.edges, ["t", "a"]))).toContain("trigger_inside");
  });

  it("refuses a block at the end of the flow (no edge leaves it)", () => {
    const r = planOf(linear.nodes, linear.edges, ["c", "d"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.blocks).toEqual([{ code: "exits", count: 0 }]);
  });

  it("refuses two ways in, or two ways out", () => {
    const nodes = [...linear.nodes, tf("x", { y: 1 })];
    const twoIn = [...linear.edges, e("a", "c")];
    expect(!planOf(nodes, twoIn, ["b", "c"]).ok && codes(planOf(nodes, twoIn, ["b", "c"]))).toEqual(
      ["entries"]
    );
    const twoOut = [...linear.edges, e("b", "x")];
    expect(codes(planOf(nodes, twoOut, ["b", "c"]))).toEqual(["exits"]);
  });

  it("refuses a step that waits for a person", () => {
    const nodes = [trigger, n("w", "wait_human"), tf("b", { y: 1 }), tf("c", { z: 1 })];
    const edges = [e("t", "w"), e("w", "b", "aprobado"), e("w", "c", "rechazado"), e("b", "c")];
    expect(codes(planOf(nodes, edges, ["w", "b"]))).toContain("wait_human_inside");
  });

  it("refuses unknown steps and an unknown group", () => {
    expect(codes(planOf(linear.nodes, linear.edges, ["b", "ghost"]))).toEqual(["unknown_step"]);
    const r = planExtraction(linear, { groupId: "nope" });
    expect(codes(r)).toEqual(["unknown_group"]);
  });

  describe("branches must rejoin before the exit", () => {
    // a -> cond -true-> hi -> join ; cond -false-> lo -> join ; join -> d
    const nodes = [
      trigger,
      tf("a", { level: "{{input}}" }),
      n("cond", "condition", { left: "{{level}}", op: "==", right: "high" }),
      tf("hi", { note: "urgent" }),
      tf("lo", { note: "normal" }),
      tf("join", { summary: "{{note}}" }),
      call("d", "post_note", { text: "{{summary}}" }),
    ];
    const edges = [
      e("t", "a"),
      e("a", "cond"),
      e("cond", "hi", "true"),
      e("cond", "lo", "false"),
      e("hi", "join"),
      e("lo", "join"),
      e("join", "d"),
    ];

    it("accepts a diamond that rejoins", () => {
      expect(planOf(nodes, edges, ["cond", "hi", "lo", "join"]).ok).toBe(true);
    });

    it("refuses a branch that leaves the block on its own", () => {
      const leaving = edges.map((x) => (x.id === "lo-join" ? e("lo", "d") : x));
      // lo -> d and join -> d: two edges leave.
      expect(codes(planOf(nodes, leaving, ["cond", "hi", "lo", "join"]))).toEqual(["exits"]);
    });

    it("refuses a branch that ends inside the block", () => {
      const ending = edges.filter((x) => x.id !== "lo-join");
      expect(codes(planOf(nodes, ending, ["cond", "hi", "lo", "join"]))).toEqual(["branch_ends"]);
    });

    it("refuses a block whose exit is one branch of a condition", () => {
      const r = planOf(nodes, edges, ["a", "cond", "hi", "lo"]);
      // hi -> join and lo -> join both leave: two exits.
      expect(codes(r)).toEqual(["exits"]);
      const single = [
        e("t", "a"),
        e("a", "cond"),
        e("cond", "hi", "true"),
        e("cond", "d", "false"),
        e("hi", "lo"),
        e("lo", "d"),
      ];
      // cond -false-> d is the only way out; hi/lo never reach it.
      expect(codes(planOf(nodes, single, ["cond", "hi", "lo"]))).toEqual(["exits"]);
      // Both branches reach the same step: that is a rejoin, and it is fine.
      const same = [
        e("t", "a"),
        e("a", "cond"),
        e("cond", "hi", "true"),
        e("cond", "hi", "false"),
        e("hi", "d"),
      ];
      expect(planOf(nodes, same, ["cond", "hi"]).ok).toBe(true);
      // The exit is the "true" branch; "false" goes on inside and ends there.
      const onBranch = [
        e("t", "a"),
        e("a", "cond"),
        e("cond", "d", "true"),
        e("cond", "hi", "false"),
      ];
      expect(codes(planOf(nodes, onBranch, ["cond", "hi"]))).toEqual([
        "branch_ends",
        "exit_on_branch",
      ]);
    });

    it("refuses a step that continues on two paths at once", () => {
      const fan = [
        e("t", "a"),
        e("a", "hi"),
        e("a", "lo"),
        e("hi", "join"),
        e("lo", "join"),
        e("join", "d"),
      ];
      expect(codes(planOf(nodes, fan, ["a", "hi", "lo", "join"]))).toEqual(["fan_out"]);
    });

    it("needs a default path out of a switch", () => {
      const sw = n("sw", "switch", { value: "{{level}}", cases: [{ value: "x", handle: "x" }] });
      const swNodes = [...nodes, sw];
      const withoutDefault = [e("t", "a"), e("a", "sw"), e("sw", "hi", "x"), e("hi", "d")];
      expect(codes(planOf(swNodes, withoutDefault, ["sw", "hi"]))).toEqual(["branch_ends"]);
      const withDefault = [...withoutDefault, e("sw", "hi", "default")];
      expect(planOf(swNodes, withDefault, ["sw", "hi"]).ok).toBe(true);
    });
  });

  describe("try/catch, loops and parallel steps", () => {
    const tc = n("tc", "try_catch", {});
    const nodes = [
      trigger,
      tc,
      call("x", "get_case", {}),
      tf("fix", { error2: "{{error}}" }),
      tf("after", { a: 1 }),
      call("d", "post_note", {}),
    ];

    it("accepts a try/catch whose branches stay inside and whose done leaves", () => {
      const edges = [
        e("t", "tc"),
        e("tc", "x", "try"),
        e("tc", "fix", "catch"),
        e("tc", "after", "done"),
        e("after", "d"),
      ];
      const plan = okPlan(nodes, edges, ["tc", "x", "fix", "after"]);
      expect(plan.exitNodeId).toBe("after");
    });

    it("refuses an exit inside the try branch", () => {
      const edges = [e("t", "tc"), e("tc", "x", "try"), e("x", "d")];
      expect(codes(planOf(nodes, edges, ["tc", "x"]))).toContain("exit_in_branch");
    });

    it("refuses a loop body that comes back to the loop", () => {
      const loop = n("loop", "loop_for_each", { items: "{{list}}" });
      const edges = [
        e("t", "loop"),
        e("loop", "x", "body"),
        e("x", "loop"),
        e("loop", "d", "done"),
      ];
      expect(codes(planOf([...nodes, loop], edges, ["loop", "x"]))).toContain("cycle");
    });
  });

  it("refuses a step of the block that the entry never reaches, but lets a note move", () => {
    const nodes = [...linear.nodes, tf("lonely", { a: 1 }), n("memo", "note", { text: "hi" })];
    expect(codes(planOf(nodes, linear.edges, ["b", "c", "lonely"]))).toEqual(["unreachable"]);
    expect(planOf(nodes, linear.edges, ["b", "c", "memo"]).ok).toBe(true);
  });

  it("refuses a selection that cuts a group in two", () => {
    const groups = [{ id: "g", name: "G", nodeIds: ["c", "d"] }];
    expect(codes(planOf(linear.nodes, linear.edges, ["b", "c"], groups))).toContain("group_split");
  });
});

describe("the variable mapping", () => {
  it("passes what the block reads from before it and returns what later steps read", () => {
    const plan = okPlan(linear.nodes, linear.edges, ["b", "c"]);
    // b reads theCase (from a); c reads caseId (run input) and priority (from b).
    expect(plan.inputs).toEqual(["caseId", "theCase"]);
    // d reads summary and priority; scratch is never read again.
    expect(plan.outputs).toEqual(["priority", "summary"]);
    expect(plan.staysInside).toEqual(["scratch"]);
  });

  it("passes a variable the block reads before writing it", () => {
    const nodes = [
      trigger,
      tf("a", { count: "{{count}}" }),
      tf("b", { count: "{{count}}", other: "1" }),
      call("d", "post_note", { n: "{{count}}" }),
    ];
    const edges = [e("t", "a"), e("a", "b"), e("b", "d")];
    expect(okPlan(nodes, edges, ["a", "b"]).inputs).toEqual(["count"]);
  });

  it("does not pass what a step inside has certainly written first", () => {
    const nodes = [
      trigger,
      call("a", "get_case", { id: "{{id}}" }),
      tf("b", { name: "{{appResult.name}}" }),
      call("d", "post_note", { n: "{{name}}" }),
    ];
    const edges = [e("t", "a"), e("a", "b"), e("b", "d")];
    expect(okPlan(nodes, edges, ["a", "b"]).inputs).toEqual(["id"]);
  });

  it("counts a variable written on only one branch as not certain", () => {
    const nodes = [
      trigger,
      n("cond", "condition", { left: "{{x}}", op: "==", right: "1" }),
      tf("hi", { label: "hi" }),
      tf("lo", { other: "lo" }),
      tf("join", { out: "{{label}}" }),
      call("d", "post_note", { n: "{{out}}" }),
    ];
    const edges = [
      e("t", "cond"),
      e("cond", "hi", "true"),
      e("cond", "lo", "false"),
      e("hi", "join"),
      e("lo", "join"),
      e("join", "d"),
    ];
    expect(okPlan(nodes, edges, ["cond", "hi", "lo", "join"]).inputs).toEqual(["label", "x"]);
  });

  it("knows the engine's implicit reads: an Agent step without a message reads `message`", () => {
    const nodes = [
      trigger,
      n("ag", "agent", { agentId: "a1" }),
      tf("b", { r: "{{agentResult}}" }),
      call("d", "post_note", { r: "{{r}}" }),
    ];
    const edges = [e("t", "ag"), e("ag", "b"), e("b", "d")];
    const plan = okPlan(nodes, edges, ["ag", "b"]);
    expect(plan.inputs).toEqual(["message"]);
    expect(plan.kind).toBe("pipeline");
    expect(plan.kindReasons.map((r) => r.code)).toEqual(["ai"]);
  });

  it("passes everything when a step inside reads variables it does not name", () => {
    const nodes = [
      trigger,
      n("js", "code", { code: "return { y: input.x }" }),
      tf("b", { z: "{{y}}" }),
      call("d", "post_note", { z: "{{z}}" }),
    ];
    const edges = [e("t", "js"), e("js", "b"), e("b", "d")];
    const plan = okPlan(nodes, edges, ["js", "b"]);
    expect(plan.inputs).toBeNull();
    expect(plan.inputsUnknown.map((u) => u.nodeId)).toEqual(["js"]);
    // The JavaScript step may write anything: every later read comes back.
    expect(plan.outputs).toEqual(["z"]);
  });

  it("returns everything produced inside when a later step reads what it does not name", () => {
    const nodes = [
      trigger,
      tf("a", { p: "1", q: "2" }),
      tf("b", { r: "3" }),
      n("js", "code", { code: "return {}" }),
    ];
    const edges = [e("t", "a"), e("a", "b"), e("b", "js")];
    const plan = okPlan(nodes, edges, ["a", "b"]);
    expect(plan.outputs).toEqual(["p", "q", "r"]);
    expect(plan.staysInside).toEqual([]);
  });

  it("brings everything back when neither side can be named", () => {
    const nodes = [
      trigger,
      n("js1", "code", { code: "return {}" }),
      tf("b", { r: "3" }),
      n("js2", "code", { code: "return {}" }),
    ];
    const edges = [e("t", "js1"), e("js1", "b"), e("b", "js2")];
    const plan = okPlan(nodes, edges, ["js1", "b"]);
    expect(plan.outputs).toBeNull();
    expect(plan.outputsUnknown.length).toBeGreaterThan(0);
  });

  it("ignores a later read that a later step writes first", () => {
    const nodes = [
      trigger,
      call("a", "get_case", {}),
      tf("b", { name: "{{appResult.name}}" }),
      call("c", "get_other", {}),
      call("d", "post_note", { r: "{{appResult}}", n: "{{name}}" }),
    ];
    const edges = [e("t", "a"), e("a", "b"), e("b", "c"), e("c", "d")];
    const plan = okPlan(nodes, edges, ["a", "b"]);
    expect(plan.outputs).toEqual(["name"]);
    expect(plan.staysInside).toEqual(["appResult"]);
  });

  it("inside a loop body, any step outside may read what the block left", () => {
    const nodes = [
      trigger,
      n("loop", "loop_for_each", { items: "{{list}}" }),
      tf("before", { seen: "{{last}}" }),
      tf("a", { last: "{{item}}" }),
      tf("b", { other: "1" }),
      tf("end", { k: 1 }),
      call("d", "post_note", {}),
    ];
    const edges = [
      e("t", "loop"),
      e("loop", "before", "body"),
      e("before", "a"),
      e("a", "b"),
      e("b", "end"),
      e("loop", "d", "done"),
    ];
    const plan = okPlan(nodes, edges, ["a", "b"]);
    expect(plan.outputs).toEqual(["last"]);
    expect(plan.notes).toContain("inside_loop");
    expect(plan.inputs).toEqual(["item"]);
  });

  it("marks a block inside a try branch", () => {
    const nodes = [
      trigger,
      n("tc", "try_catch", {}),
      tf("a", { x: 1 }),
      tf("b", { y: 1 }),
      tf("c", { z: 1 }),
    ];
    const edges = [e("t", "tc"), e("tc", "a", "try"), e("a", "b"), e("b", "c")];
    expect(okPlan(nodes, edges, ["a", "b"]).notes).toContain("inside_try");
  });

  it("an action unless the block uses AI, a person or another flow", () => {
    expect(okPlan(linear.nodes, linear.edges, ["b", "c"]).kind).toBe("action");
    const nodes = [
      trigger,
      n("s", "subflow", { flowId: "f2", inputs: {}, outputs: {} }),
      tf("b", { y: 1 }),
      call("d", "x", {}),
    ];
    const plan = okPlan(nodes, [e("t", "s"), e("s", "b"), e("b", "d")], ["s", "b"]);
    expect(plan.kind).toBe("pipeline");
    expect(plan.notes).toContain("calls_subflows");
  });
});

describe("buildExtraction", () => {
  const groups = [
    {
      id: "g",
      name: "Shape the note",
      icon: "Wand2",
      description: "One line",
      nodeIds: ["b", "c"],
    },
  ];
  const graph = {
    nodes: linear.nodes.map((x, i) => ({ ...x, position: { x: i * 300, y: 100 + i * 10 } })),
    edges: [e("t", "a"), e("a", "b"), e("b", "c"), { ...e("c", "d"), label: "next" }],
    groups,
  };
  const r = planExtraction(graph, { groupId: "g" });
  if (!r.ok) throw new Error("plan expected");
  const meta = { name: "Shape the note", description: "One line", icon: "Wand2" as const };
  const { parent, child } = buildExtraction(graph, r.plan, meta, {
    childFlowId: "flow_child",
    subflowNodeId: "sub_1",
  });

  it("replaces the block in the parent with one subflow step wired with the mapping", () => {
    expect(parent.nodes.map((x) => x.id)).toEqual(["t", "a", "sub_1", "d"]);
    const sub = parent.nodes.find((x) => x.id === "sub_1")!;
    expect(sub).toEqual({
      id: "sub_1",
      type: "subflow",
      label: "Shape the note",
      purpose: "One line",
      position: { x: 600, y: 120 },
      config: {
        flowId: "flow_child",
        inputs: { caseId: "{{caseId}}", theCase: "{{theCase}}" },
        outputs: { priority: "priority", summary: "summary" },
        icon: "Wand2",
      },
    });
    expect(parent.edges).toEqual([
      e("t", "a"),
      { ...e("a", "b"), target: "sub_1" },
      { id: "c-d", source: "sub_1", target: "d", label: "next" },
    ]);
    // The extracted group is consumed by the step.
    expect(parent.groups).toEqual([]);
  });

  it("builds the new flow: a manual trigger, the moved steps and their edges", () => {
    expect(child.nodes.map((x) => [x.id, x.type, x.position])).toEqual([
      ["trigger", "trigger", { x: 0, y: 80 }],
      ["b", "transform", { x: 280, y: 80 }],
      ["c", "transform", { x: 580, y: 90 }],
    ]);
    expect(child.edges).toEqual([{ id: "e-trigger", source: "trigger", target: "b" }, e("b", "c")]);
    expect(child.groups).toEqual([]);
  });

  it("leaves two graphs without errors", () => {
    const errors = (g: { nodes: unknown; edges: unknown }) =>
      validateStoredFlow(g.nodes, g.edges).filter((i) => i.level === "error");
    expect(errors(parent)).toEqual([]);
    expect(errors(child)).toEqual([]);
  });

  it("moves groups that are entirely inside a selection", () => {
    const g2 = { id: "inner", name: "Inner", nodeIds: ["b", "c"] };
    const sel = planExtraction({ ...graph, groups: [g2] }, { nodeIds: ["b", "c"] });
    if (!sel.ok) throw new Error("plan expected");
    expect(sel.plan.movedGroupIds).toEqual(["inner"]);
    const out = buildExtraction({ ...graph, groups: [g2] }, sel.plan, meta, {
      childFlowId: "c",
      subflowNodeId: "s",
    });
    expect(out.child.groups).toEqual([g2]);
    expect(out.parent.groups).toEqual([]);
  });

  it("writes a spec from the plan", () => {
    const spec = extractionSpec(r.plan, meta, "Parent flow");
    expect(spec).toContain("One line");
    expect(spec).toContain('Extracted from the flow "Parent flow"');
    expect(spec).toContain("- `caseId`");
    expect(spec).toContain("- `summary`");
  });
});
