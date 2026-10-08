// The key property of "Extract to flow": a parent run behaves the same before
// and after the block moves into its own flow. Both versions run through the
// real `executeFlow` over an in-memory database (nested child runs included),
// with integrations mocked; the test compares final outputs, the integration
// calls in order, and failures.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetTables, tables } from "./flow-engine-memdb";
import { buildExtraction, planExtraction, type ExtractionPlan } from "@/lib/flows/extract";

vi.mock("@orchester/db", async () => (await import("./flow-engine-memdb")).memDb);
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  const mem = await import("./flow-engine-memdb");
  return { ...actual, eq: mem.memEq, and: mem.memAnd };
});
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@/lib/ai/run", () => ({ runChat: vi.fn(), chargeFor: vi.fn(), recordAiUsage: vi.fn() }));
let idCounter = 0;
vi.mock("@paralleldrive/cuid2", () => ({ createId: () => `id_${++idCounter}` }));

const calls: Array<{ action: string; input: unknown }> = [];
vi.mock("@/lib/integrations/store", () => ({
  runIntegrationAction: async (_ws: string, _id: string, action: string, input: unknown) => {
    calls.push({ action, input });
    const i = input as Record<string, unknown>;
    if (action === "get_ticket") {
      return {
        id: i.id,
        title: `Ticket ${String(i.id)}`,
        priority: i.id === "T-1" ? "high" : "low",
      };
    }
    if (action === "add_tag" && i.id === "T-broken") throw new Error("remote error: tag refused");
    return { ok: true, action };
  },
  getIntegrationActionEffect: async (_ws: string, _id: string, action: string) =>
    action.startsWith("get_") ? "read" : "write",
}));

const WS = "ws_test";
const node = (id: string, type: string, config: Record<string, unknown>, x = 0) => ({
  id,
  type,
  label: id,
  config,
  position: { x, y: 0 },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const app = (id: string, action: string, input: Record<string, unknown>, outputVar: string) =>
  node(id, "integration", { integrationId: `tickets::${action}`, input, outputVar });

/** A support-style pipeline: load a ticket, enrich it (the block), post a note. */
const parent = {
  id: "flow_parent",
  workspaceId: WS,
  name: "Ticket pipeline",
  enabled: true,
  kind: "pipeline",
  variables: {},
  nodes: [
    node("t", "trigger", { triggerKind: "manual" }),
    app("load", "get_ticket", { id: "{{ticketId}}" }, "ticket"),
    node("prio", "transform", {
      template: { priority: "{{ticket.priority}}", scratch: "{{ticket.id}}" },
    }),
    node("check", "condition", { left: "{{priority}}", op: "==", right: "high" }),
    app("escalate", "page_oncall", { ticket: "{{ticketId}}", text: "{{ticket.title}}" }, "page"),
    app("tag", "add_tag", { id: "{{ticketId}}", tag: "low" }, "tagResult"),
    node("summary", "transform", {
      template: { summary: "{{ticket.title}} ({{priority}})", paged: "{{page.ok}}" },
    }),
    app("note", "post_note", { id: "{{ticketId}}", body: "{{summary}}" }, "noteResult"),
  ],
  edges: [
    edge("t", "load"),
    edge("load", "prio"),
    edge("prio", "check"),
    edge("check", "escalate", "true"),
    edge("check", "tag", "false"),
    edge("escalate", "summary"),
    edge("tag", "summary"),
    edge("summary", "note"),
  ],
  groups: [
    {
      id: "g_enrich",
      name: "Enrich the ticket",
      description: "Priority, escalation and summary",
      icon: "Wand2",
      nodeIds: ["prio", "check", "escalate", "tag", "summary"],
    },
  ],
};

interface Outcome {
  status: string;
  error: string | undefined;
  output: Record<string, unknown>;
  calls: Array<{ action: string; input: unknown }>;
}

async function run(
  flows: Array<Record<string, unknown>>,
  input: Record<string, unknown>,
  dryRun = false
): Promise<Outcome> {
  resetTables();
  tables.flows = flows.map((f) => structuredClone(f));
  calls.length = 0;
  const { executeFlow } = await import("@/lib/flow-engine");
  const r = await executeFlow({
    flowId: "flow_parent",
    workspaceId: WS,
    triggerSource: "test",
    input,
    ...(dryRun ? { dryRun: true } : {}),
  });
  const row = tables.flowRuns.find((x) => x.id === r.runId)!;
  return {
    status: r.status,
    error: r.error,
    output: (row.output ?? {}) as Record<string, unknown>,
    calls: [...calls],
  };
}

type TestFlow = Omit<typeof parent, "groups"> & {
  groups: Array<{ id: string; name: string; description?: string; nodeIds: string[] }>;
};

function extract(flow: TestFlow, groupId: string) {
  const planned = planExtraction(flow, { groupId });
  if (!planned.ok) throw new Error(`not extractable: ${JSON.stringify(planned.blocks)}`);
  const group = flow.groups.find((g) => g.id === groupId)!;
  const { parent: p, child } = buildExtraction(
    flow,
    planned.plan,
    { name: group.name, description: group.description, icon: "Wand2" },
    { childFlowId: "flow_child", subflowNodeId: "sub_enrich" }
  );
  const childFlow = {
    id: "flow_child",
    workspaceId: WS,
    name: group.name,
    // Created enabled: a disabled flow refuses calls from other flows.
    enabled: true,
    kind: planned.plan.kind,
    variables: {},
    ...child,
  };
  return { plan: planned.plan, flows: [{ ...flow, ...p }, childFlow] };
}

const without = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Same outcome, except variables that now stay inside the new flow. */
function expectEquivalent(before: Outcome, after: Outcome, plan: ExtractionPlan) {
  expect(after.status).toBe(before.status);
  expect(after.calls).toEqual(before.calls);
  expect(after.output).toEqual(without(before.output, plan.staysInside));
  for (const k of plan.staysInside) expect(after.output).not.toHaveProperty(k);
}

beforeEach(() => {
  idCounter = 0;
});

describe("extracting a block keeps the parent's behaviour", () => {
  const extracted = extract(parent, "g_enrich");

  it("infers the mapping the block needs", () => {
    expect(extracted.plan.kind).toBe("action");
    // `page` is written on one branch only, so the block may read it from before.
    expect(extracted.plan.inputs).toEqual(["page", "ticket", "ticketId"]);
    expect(extracted.plan.outputs).toEqual(["summary"]);
    expect(extracted.plan.staysInside).toEqual([
      "page",
      "paged",
      "priority",
      "scratch",
      "tagResult",
    ]);
  });

  it.each([
    ["the escalation branch inside the block", { ticketId: "T-1" }],
    ["the other branch inside the block", { ticketId: "T-2" }],
  ])("runs %s the same way", async (_label, input) => {
    const before = await run([parent], input);
    const after = await run(extracted.flows, input);
    expect(before.status).toBe("succeeded");
    expectEquivalent(before, after, extracted.plan);
    // The child really ran, with only the mapped inputs (`page` is unset before the block).
    const childRun = tables.flowRuns.find((r) => r.flowId === "flow_child")!;
    expect(Object.keys(childRun.input as object).sort()).toEqual(["ticket", "ticketId"]);
  });

  it("takes the same branch: escalation calls page_oncall, the other add_tag", async () => {
    const high = await run(extracted.flows, { ticketId: "T-1" });
    const low = await run(extracted.flows, { ticketId: "T-2" });
    expect(high.calls.map((c) => c.action)).toEqual(["get_ticket", "page_oncall", "post_note"]);
    expect(low.calls.map((c) => c.action)).toEqual(["get_ticket", "add_tag", "post_note"]);
    expect(high.output.summary).toBe("Ticket T-1 (high)");
  });

  it("fails the same way when a step inside fails, with the child's error on the parent step", async () => {
    const input = { ticketId: "T-broken" };
    const before = await run([parent], input);
    const after = await run(extracted.flows, input);
    expect(before.status).toBe("failed");
    expect(after.status).toBe("failed");
    expect(after.calls).toEqual(before.calls);
    expect(after.calls.map((c) => c.action)).toEqual(["get_ticket", "add_tag"]);

    // Inside the child, the same step fails with the same error as before.
    const childRun = tables.flowRuns.find((r) => r.flowId === "flow_child")!;
    expect(childRun.status).toBe("failed");
    expect(childRun.error).toBe(before.error);
    const childStep = tables.flowRunSteps.find(
      (s) => s.runId === childRun.id && s.nodeId === "tag"
    )!;
    expect(childStep.status).toBe("failed");
    // In the parent, the subflow step fails carrying the child's error.
    const parentRun = tables.flowRuns.find((r) => r.flowId === "flow_parent")!;
    const subStep = tables.flowRunSteps.find(
      (s) => s.runId === parentRun.id && s.nodeId === "sub_enrich"
    )!;
    expect(subStep.status).toBe("failed");
    expect(subStep.error).toBe(`subflow failed: ${before.error}`);
    expect(after.error).toBe(`subflow failed: ${before.error}`);
  });

  it("dry-runs the same way: reads run, writes are simulated, in both versions", async () => {
    const before = await run([parent], { ticketId: "T-1" }, true);
    const after = await run(extracted.flows, { ticketId: "T-1" }, true);
    expect(before.calls.map((c) => c.action)).toEqual(["get_ticket"]);
    expectEquivalent(before, after, extracted.plan);
  });
});

describe("a block the analysis cannot fully name", () => {
  // A JavaScript step reads `input.*` freely: the child must receive every
  // variable, and only what later steps read comes back.
  const withCode: TestFlow = {
    ...parent,
    nodes: [
      node("t", "trigger", { triggerKind: "manual" }),
      app("load", "get_ticket", { id: "{{ticketId}}" }, "ticket"),
      node("js", "code", {
        code: "return { total: input.items.length, label: input.prefix + ':' + input.ticket.title };",
      }),
      node("fmt", "transform", { template: { line: "{{label}} x{{total}}" } }),
      app("note", "post_note", { id: "{{ticketId}}", body: "{{line}}" }, "noteResult"),
    ],
    edges: [edge("t", "load"), edge("load", "js"), edge("js", "fmt"), edge("fmt", "note")],
    groups: [{ id: "g_code", name: "Format", nodeIds: ["js", "fmt"] }],
  };

  beforeEach(() => vi.stubEnv("FLOW_CODE_EXECUTION", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("passes every variable in and still behaves the same", async () => {
    const extracted = extract(withCode, "g_code");
    expect(extracted.plan.inputs).toBeNull();
    // The JavaScript step may write any variable, so everything read later comes back.
    expect(extracted.plan.outputs).toEqual(["line", "ticketId"]);
    const input = { ticketId: "T-2", items: [1, 2, 3], prefix: "Note" };
    const before = await run([withCode], input);
    const after = await run(extracted.flows, input);
    expect(before.status).toBe("succeeded");
    expect(after.status).toBe(before.status);
    expect(after.calls).toEqual(before.calls);
    expect(after.calls.at(-1)?.input).toEqual({ id: "T-2", body: "Note:Ticket T-2 x3" });
    // What the JavaScript step writes cannot be listed ahead of time, so the plan
    // says so instead of naming it; here that is its scratch `label` and `total`,
    // which no later step reads and which now stay in the new flow.
    expect(extracted.plan.staysInsideUnknown.map((u) => u.nodeId)).toEqual(["js"]);
    expect(after.output).toEqual(without(before.output, ["label", "total"]));
  });
});
