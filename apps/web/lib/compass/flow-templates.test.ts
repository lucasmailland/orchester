import { describe, it, expect } from "vitest";
import { getTemplatesFor, type FlowTemplatePayload } from "./templates";
import { normalizeFlowNodes, normalizeFlowEdges, specToStoredGraph } from "@/lib/flows/normalize";
import { FLOW_TEMPLATES as EDITOR_TEMPLATES } from "@/lib/flows/templates";
import { buildGraphFromSpec } from "@/lib/flows/copilot-tools";
import { validateFlow } from "@/lib/flows/validate";
import { getConnector } from "@/lib/integrations/registry";

interface Stored {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

const templates = getTemplatesFor("flow");
const withGraph = templates.filter((t) => !t.blank);

// How the editor decides which registry step a stored node is.
const nodeIdOf = (n: Stored) =>
  n.type === "trigger" ? `trigger_${String(n.config.triggerKind ?? "manual")}` : n.type;

function graph(payload: FlowTemplatePayload) {
  return {
    nodes: (payload.nodes ?? []) as Stored[],
    edges: (payload.edges ?? []) as Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
    }>,
  };
}

describe("Compass flow templates", () => {
  it("offers a blank flow that really is empty", () => {
    // The card promised a Trigger node, but picking Blank opens an empty canvas
    // with the editor's start guide.
    const blank = templates.find((t) => t.blank);
    expect(graph(blank!.payload).nodes).toEqual([]);
  });

  it.each(withGraph.map((t) => [t.id, t]))(
    "%s is stored in the shape the editor opens",
    (_id, t) => {
      // These templates used to send { type, data: { label } } nodes that the
      // editor could not read, so every flow created from them crashed on open.
      const { nodes, edges } = graph(t.payload);
      expect(nodes.length).toBeGreaterThan(0);
      expect(normalizeFlowNodes(nodes)).toEqual(nodes);
      expect(normalizeFlowEdges(edges)).toEqual(edges);
    }
  );

  it.each(withGraph.map((t) => [t.id, t]))(
    "%s uses only real steps, never placeholder notes",
    (_id, t) => {
      expect(graph(t.payload).nodes.map((n) => n.type)).not.toContain("note");
    }
  );

  it.each(withGraph.map((t) => [t.id, t]))(
    "%s only asks the user to fill in fields — it has a start, and no broken or loose steps",
    (_id, t) => {
      const { nodes, edges } = graph(t.payload);
      const issues = validateFlow(
        nodes.map((n) => ({
          id: n.id,
          type: n.type,
          data: { nodeId: nodeIdOf(n), label: n.label, config: n.config },
        })),
        edges
      );
      for (const issue of issues) expect(issue.message).toMatch(/le falta completar/);
    }
  );

  it.each(withGraph.map((t) => [t.id, t]))(
    "%s routes every condition through true/false",
    (_id, t) => {
      const { nodes, edges } = graph(t.payload);
      for (const cond of nodes.filter((n) => n.type === "condition")) {
        expect(cond.config.op).toBeTruthy();
        for (const e of edges.filter((ed) => ed.source === cond.id)) {
          expect(["true", "false"]).toContain(e.sourceHandle);
        }
      }
    }
  );

  it.each(withGraph.map((t) => [t.id, t]))(
    "%s names integrations as an existing connector::action",
    (_id, t) => {
      for (const n of graph(t.payload).nodes.filter((x) => x.type === "integration")) {
        const [type, action] = String(n.config.integrationId).split("::");
        expect(getConnector(type!)?.actions[action!], `${type}::${action}`).toBeDefined();
      }
    }
  );
});

describe("specToStoredGraph", () => {
  // Compass cannot import buildGraphFromSpec — it drags the node docs into
  // every "+ New" page — so it has its own conversion. This keeps both in step.
  it.each(EDITOR_TEMPLATES.map((t) => [t.id, t]))(
    "matches the editor's conversion for %s",
    (_id, t) => {
      let i = 0;
      const built = buildGraphFromSpec(t.spec, () => `x${i++}`);
      const stored = specToStoredGraph(t.spec);
      expect(stored.nodes.map((n) => ({ type: n.type, label: n.label, config: n.config }))).toEqual(
        built.nodes.map((n) => ({ type: n.type, label: n.data.label, config: n.data.config }))
      );
      expect(stored.edges.map((e) => e.sourceHandle)).toEqual(
        built.edges.map((e) => e.sourceHandle)
      );
    }
  );
});
