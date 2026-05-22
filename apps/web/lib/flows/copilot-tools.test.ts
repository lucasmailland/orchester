import { describe, it, expect } from "vitest";
import { buildGraphFromSpec, nodeCatalogForPrompt, type FlowSpec } from "./copilot-tools";

let counter = 0;
const idFor = () => `id${counter++}`;

describe("buildGraphFromSpec", () => {
  it("builds valid nodes/edges, mapping engine types and merging defaults", () => {
    counter = 0;
    const spec: FlowSpec = {
      nodes: [
        { id: "start", nodeId: "trigger_manual" },
        { id: "a", nodeId: "agent", label: "Responder", config: { agentId: "x" } },
      ],
      edges: [{ source: "start", target: "a" }],
    };
    const out = buildGraphFromSpec(spec, idFor);
    expect(out.errors).toEqual([]);
    expect(out.nodes).toHaveLength(2);
    const trigger = out.nodes[0]!;
    expect(trigger.type).toBe("trigger");
    expect(trigger.data.nodeId).toBe("trigger_manual");
    expect(trigger.data.config.triggerKind).toBe("manual"); // fixedConfig merged
    const agent = out.nodes[1]!;
    expect(agent.type).toBe("agent");
    expect(agent.data.label).toBe("Responder");
    expect(agent.data.config.agentId).toBe("x");
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.source).toBe(trigger.id);
    expect(out.edges[0]!.target).toBe(agent.id);
  });

  it("reports unknown node types and invalid edges", () => {
    counter = 0;
    const out = buildGraphFromSpec(
      { nodes: [{ id: "x", nodeId: "not_a_real_node" }], edges: [{ source: "x", target: "y" }] },
      idFor
    );
    expect(out.nodes).toHaveLength(0);
    expect(out.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("positions nodes in increasing columns by depth", () => {
    counter = 0;
    const out = buildGraphFromSpec(
      {
        nodes: [
          { id: "t", nodeId: "trigger_manual" },
          { id: "b", nodeId: "agent" },
        ],
        edges: [{ source: "t", target: "b" }],
      },
      idFor
    );
    expect(out.nodes[1]!.position.x).toBeGreaterThan(out.nodes[0]!.position.x);
  });
});

describe("nodeCatalogForPrompt", () => {
  it("lists known nodes with their ids", () => {
    const cat = nodeCatalogForPrompt("es");
    expect(cat).toContain("trigger_manual:");
    expect(cat).toContain("agent:");
    expect(cat).toContain("http:");
  });
});
