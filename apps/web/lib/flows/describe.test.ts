import { describe, it, expect } from "vitest";
import { describeFlow, type DescribeFlowInput } from "./describe";

const base = (over: Partial<DescribeFlowInput>): DescribeFlowInput => ({
  id: "f1",
  name: "Pipeline",
  enabled: true,
  nodes: [],
  edges: [],
  variables: {},
  ...over,
});

const pipeline = base({
  externalCallers: [{ name: "nightly script" }],
  nodes: [
    { id: "t", type: "trigger", label: "Start", config: {} },
    {
      id: "a",
      type: "agent",
      label: "Draft reply",
      config: { agentId: "ag1", prompt: "Reply to {{message | trim}}", outputVar: "answer" },
    },
    { id: "h", type: "wait_human", label: "Approve", config: { instructions: "Ok? {{answer}}" } },
    {
      id: "c1",
      type: "integration",
      label: "Find contact",
      config: {
        integrationId: "crm::get_contact",
        input: { id: "{{contactId}}" },
        outputVar: "contact",
      },
    },
    {
      id: "c2",
      type: "integration",
      label: "Save note",
      config: {
        integrationId: "crm::update_contact",
        input: { note: "{{answer}}", who: ["{{contact.name | upper}}"] },
      },
    },
    {
      id: "s",
      type: "subflow",
      label: "Totals",
      config: {
        flowId: "f2",
        inputs: { x: "{{contact.id}}" },
        // Evaluated against the child's variables: not a read of this flow.
        outputs: { total: "result.total", extra: "{{childOnly}}" },
      },
    },
    {
      id: "x",
      type: "transform",
      label: "Join",
      config: { target: "summary", value: "{{answer}} {{total}}" },
    },
  ],
});

const ctx = {
  otherFlows: [],
  webhooks: [],
  effects: { c1: "read", c2: "write" } as const,
};

describe("describeFlow", () => {
  it("produces the exact sheet of a pipeline", () => {
    const sheet = describeFlow(pipeline, {
      ...ctx,
      otherFlows: [
        { id: "f1", name: "Pipeline", nodes: pipeline.nodes },
        {
          id: "f9",
          name: "Caller",
          nodes: [{ id: "q", type: "subflow", config: { flowId: "f1" } }],
        },
        { id: "f8", name: "Unrelated", nodes: [{ id: "q", type: "http", config: {} }] },
      ],
      webhooks: [
        { id: "w1", enabled: true },
        { id: "w2", enabled: false },
      ],
    });
    expect(sheet).toEqual({
      flowId: "f1",
      kind: "pipeline",
      enabled: true,
      externalCallers: [{ name: "nightly script" }],
      steps: {
        total: 7,
        counts: { ai: 1, human: 1, code: 4, control: 1 },
        ai: [{ nodeId: "a", label: "Draft reply", type: "agent", agentId: "ag1" }],
        human: [{ nodeId: "h", label: "Approve", type: "wait_human" }],
      },
      reads: { variables: ["contactId", "message"], unknown: [] },
      writes: {
        variables: ["answer", "answerMeta", "appResult", "contact", "extra", "summary", "total"],
        unknown: [],
      },
      calls: {
        subflows: [{ nodeId: "s", flowId: "f2", inputs: ["x"], outputs: ["extra", "total"] }],
        integrations: [
          { nodeId: "c1", integration: "crm", action: "get_contact", effect: "read" },
          { nodeId: "c2", integration: "crm", action: "update_contact", effect: "write" },
        ],
      },
      calledBy: {
        flows: [{ id: "f9", name: "Caller" }],
        externalCallers: [{ name: "nightly script" }],
        webhooks: [
          { id: "w1", enabled: true },
          { id: "w2", enabled: false },
        ],
      },
      contract: [],
    });
  });

  it("lists contract issues for an action and none for a pipeline", () => {
    const nodes = [
      { id: "a", type: "llm_prompt", label: "Ask", config: { model: "m1", prompt: "{{q}}" } },
      { id: "h", type: "wait_human", label: "Wait", config: {} },
      { id: "s", type: "subflow", label: "Sub", config: { flowId: "f3" } },
    ];
    const action = describeFlow(base({ kind: "action", variables: { v: 1 }, nodes }), ctx);
    expect(action.kind).toBe("action");
    expect(action.contract.map((i) => [i.level, i.nodeId])).toEqual([
      ["error", "a"],
      ["error", "h"],
      ["error", "s"],
      ["error", undefined],
    ]);
    expect(describeFlow(base({ nodes }), ctx).contract).toEqual([]);
    expect(action.steps.ai).toEqual([
      { nodeId: "a", label: "Ask", type: "llm_prompt", model: "m1" },
    ]);
  });

  it("extracts reads and writes from nested configs and legacy nodes", () => {
    const sheet = describeFlow(
      base({
        nodes: [
          {
            id: "h",
            type: "http",
            label: "Call",
            config: {
              url: "https://x/{{id}}",
              headers: { a: "{{token}}" },
              body: { list: [{ n: "{{ order.items.0.n }}" }] },
              outputVar: "resp",
            },
          },
          {
            id: "l",
            type: "loop_for_each",
            label: "Loop",
            config: { items: "{{resp.rows}}", itemVar: "row", outputVar: "all" },
          },
          {
            id: "n",
            type: "notify",
            label: "Tell",
            config: { message: "{{row.name}} {{missing}}" },
          },
          { id: "tc", type: "try_catch", label: "Try", config: {} },
          {
            id: "cd",
            type: "code",
            label: "Legacy",
            config: { source: "set total = {{a}}\nset flag = true" },
          },
          { id: "tr", type: "transform", label: "T", config: { template: { k1: "{{p}}", k2: 1 } } },
        ],
      }),
      ctx
    );
    expect(sheet.reads.variables).toEqual(["a", "id", "missing", "order", "p", "token"]);
    expect(sheet.writes.variables).toEqual([
      "all",
      "error",
      "flag",
      "k1",
      "k2",
      "resp",
      "row",
      "total",
    ]);
  });

  it("keeps what it cannot resolve statically as unknown", () => {
    const sheet = describeFlow(
      base({
        nodes: [
          { id: "js", type: "code", label: "JS", config: { code: "return { a: input.b }" } },
          { id: "sh", type: "spreadsheet", label: "Sheet", config: { formula: "=a+b" } },
          { id: "e", type: "notify", label: "N", config: { message: "{{ ['k'] }}" } },
          { id: "s", type: "subflow", label: "S", config: { flowId: "f2" } },
          { id: "tp", type: "transform", label: "T", config: { template: "{{whole}}" } },
        ],
      }),
      ctx
    );
    expect(sheet.reads.variables).toEqual(["whole"]);
    expect(sheet.reads.unknown.map((u) => u.nodeId)).toEqual(["js", "sh", "e"]);
    expect(sheet.writes.unknown.map((u) => u.nodeId)).toEqual(["js", "s", "tp"]);
    expect(sheet.writes.variables).toEqual(["result"]);
  });

  it("never guesses the effect of an action it cannot resolve", () => {
    const sheet = describeFlow(
      base({
        nodes: [
          { id: "i", type: "integration", label: "I", config: { integrationId: "odoo::execute" } },
          { id: "j", type: "integration", label: "J", config: {} },
        ],
      }),
      ctx
    );
    expect(sheet.calls.integrations).toEqual([
      { nodeId: "i", integration: "odoo", action: "execute", effect: "unknown" },
      { nodeId: "j", integration: "", action: "", effect: "unknown" },
    ]);
  });

  it("defaults kind to pipeline and tolerates malformed stored data", () => {
    const sheet = describeFlow(
      {
        id: "z",
        name: "Z",
        enabled: false,
        nodes: null,
        edges: null,
        variables: null,
        externalCallers: "x",
      },
      { otherFlows: [], webhooks: [], effects: {} }
    );
    expect(sheet.kind).toBe("pipeline");
    expect(sheet.steps.total).toBe(0);
    expect(sheet.externalCallers).toEqual([]);
  });
});
