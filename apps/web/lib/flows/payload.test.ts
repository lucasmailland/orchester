import { describe, it, expect } from "vitest";
import { buildFlowPayload, flowSignature, type BuilderNode, type BuilderEdge } from "./payload";

// What the editor holds right after opening a stored flow.
const nodes: BuilderNode[] = [
  {
    id: "n1",
    type: "trigger",
    position: { x: 80, y: 160 },
    data: { label: "Inbound message", subtitle: "Manual", config: { mode: "manual" } },
  },
  {
    id: "n2",
    type: "agent",
    position: { x: 320, y: 160 },
    data: { label: "Support agent", config: { agentId: "a1" } },
  },
];
const edges: BuilderEdge[] = [{ id: "e1", source: "n1", target: "n2" }];
const variables = { message: "" };

describe("buildFlowPayload", () => {
  it("keeps only what the API stores", () => {
    expect(buildFlowPayload(nodes, edges, variables)).toEqual({
      nodes: [
        {
          id: "n1",
          type: "trigger",
          label: "Inbound message",
          config: { mode: "manual" },
          position: { x: 80, y: 160 },
        },
        {
          id: "n2",
          type: "agent",
          label: "Support agent",
          config: { agentId: "a1" },
          position: { x: 320, y: 160 },
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
      variables: { message: "" },
    });
  });

  it("defaults a missing config to an empty object", () => {
    const payload = buildFlowPayload([{ ...nodes[0]!, data: { label: "x" } }], [], {});
    expect(payload.nodes[0]!.config).toEqual({});
  });

  it("adds sourceHandle and label to an edge only when it has them", () => {
    const payload = buildFlowPayload(
      nodes,
      [
        { id: "e1", source: "n1", target: "n2", sourceHandle: "yes", label: "Sí" },
        { id: "e2", source: "n2", target: "n1", sourceHandle: null, label: 42 },
      ],
      {}
    );
    expect(payload.edges[0]!).toEqual({
      id: "e1",
      source: "n1",
      target: "n2",
      sourceHandle: "yes",
      label: "Sí",
    });
    expect(payload.edges[1]!).toEqual({ id: "e2", source: "n2", target: "n1" });
  });
});

describe("flowSignature", () => {
  const base = flowSignature(buildFlowPayload(nodes, edges, variables));

  // The reason this module exists: React Flow measures and selects nodes after
  // mounting, which used to look like an edit and auto-saved the flow.
  it("ignores the fields React Flow adds after mounting", () => {
    const measured = nodes.map((n) => ({
      ...n,
      measured: { width: 220, height: 64 },
      width: 220,
      height: 64,
      selected: true,
      dragging: false,
      positionAbsolute: { x: n.position.x, y: n.position.y },
      data: { ...(n.data as Record<string, unknown>), subtitle: "changed by the editor" },
    }));
    expect(flowSignature(buildFlowPayload(measured, edges, variables))).toBe(base);
  });

  it("changes when a node moves", () => {
    const moved = [{ ...nodes[0]!, position: { x: 81, y: 160 } }, nodes[1]!];
    expect(flowSignature(buildFlowPayload(moved, edges, variables))).not.toBe(base);
  });

  it("changes when a label or a config changes", () => {
    const relabelled = [
      { ...nodes[0]!, data: { ...(nodes[0]!.data as Record<string, unknown>), label: "Otro" } },
      nodes[1]!,
    ];
    const reconfigured = [
      nodes[0]!,
      {
        ...nodes[1]!,
        data: { ...(nodes[1]!.data as Record<string, unknown>), config: { agentId: "a2" } },
      },
    ];
    expect(flowSignature(buildFlowPayload(relabelled, edges, variables))).not.toBe(base);
    expect(flowSignature(buildFlowPayload(reconfigured, edges, variables))).not.toBe(base);
  });

  it("changes when an edge or a variable changes", () => {
    const moreEdges = [...edges, { id: "e2", source: "n2", target: "n1" }];
    expect(flowSignature(buildFlowPayload(nodes, moreEdges, variables))).not.toBe(base);
    expect(flowSignature(buildFlowPayload(nodes, edges, { message: "hola" }))).not.toBe(base);
  });
});
