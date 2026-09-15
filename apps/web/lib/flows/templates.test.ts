import { describe, it, expect } from "vitest";
import { FLOW_TEMPLATES } from "./templates";
import { buildGraphFromSpec } from "./copilot-tools";
import { evaluateCondition, deepInterpolate } from "@/lib/flow-engine";
import { getConnector } from "@/lib/integrations/registry";

type Condition = Parameters<typeof evaluateCondition>[0];

let counter = 0;
const idFor = () => `n${counter++}`;

function build(id: string) {
  const template = FLOW_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`template ${id} not found`);
  counter = 0;
  return buildGraphFromSpec(template.spec, idFor);
}

// buildGraphFromSpec only catches unknown steps and dangling edges. It does not
// check required fields or branch handles, which is how a template whose
// condition could never route reached production. These tests check the parts
// the engine actually depends on.
describe("FLOW_TEMPLATES", () => {
  it.each(FLOW_TEMPLATES.map((t) => [t.id]))("%s builds without errors", (id) => {
    expect(build(id).errors).toEqual([]);
  });

  it.each(FLOW_TEMPLATES.map((t) => [t.id]))(
    "%s gives every condition an operator and routes it through true/false",
    (id) => {
      const out = build(id);
      for (const cond of out.nodes.filter((n) => n.type === "condition")) {
        const cfg = cond.data.config as Record<string, unknown>;
        // The engine throws "Falta elegir la comparación" without an operator.
        expect(cfg.op ?? (cfg.condition as Condition | undefined)?.op).toBeTruthy();
        // The engine only follows edges whose sourceHandle matches the result;
        // an edge without one is never taken.
        const handles = out.edges.filter((e) => e.source === cond.id).map((e) => e.sourceHandle);
        expect(handles.every((h) => h === "true" || h === "false")).toBe(true);
      }
    }
  );
});

describe("FLOW_TEMPLATES integrations", () => {
  it.each(FLOW_TEMPLATES.map((t) => [t.id]))(
    "%s names each integration as an existing connector::action",
    (id) => {
      // A template cannot know a workspace's integration row ids, so it names
      // the connector type; the store resolves it to that workspace's row.
      for (const node of build(id).nodes.filter((n) => n.type === "integration")) {
        const [type, action] = String(node.data.config.integrationId).split("::");
        expect(getConnector(type!)?.actions[action!], `${type}::${action}`).toBeDefined();
      }
    }
  );
});

describe("chatbot-support-ticket", () => {
  const base = {
    name: "No puedo fichar desde el celular",
    description_text: "Detalle del problema",
    priority: "medium",
    team_id: 8,
    tag_ids: [12],
    category: "Problema al fichar",
    reporter: { username: "GestionHR", companyId: "c1" },
    affectedColleagueName: "",
  };

  function graph() {
    const out = build("chatbot-support-ticket");
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    const cond = out.nodes.find((n) => n.type === "condition");
    if (!cond) throw new Error("template has no condition");
    const branch = (handle: "true" | "false") => {
      const edge = out.edges.find((e) => e.source === cond.id && e.sourceHandle === handle);
      return edge ? byId.get(edge.target) : undefined;
    };
    return { cond, branch };
  }

  // search_tickets returns { tickets }, and the integration node stores that
  // object under outputVar as-is.
  it("adds a note to the open ticket when a similar one exists", () => {
    const { cond, branch } = graph();
    const ctx = { ...base, similares: { tickets: [{ id: 42, name: base.name }] } };

    expect(evaluateCondition(cond.data.config as unknown as Condition, ctx)).toBe(true);
    const note = branch("true");
    expect(note?.data.config.integrationId).toBe("odoo::post_note");
    const input = deepInterpolate(note?.data.config.input, ctx) as Record<string, unknown>;
    expect(input.id).toBe(42);
  });

  it("creates a ticket when nothing similar is open", () => {
    const { cond, branch } = graph();
    const ctx = { ...base, similares: { tickets: [] } };

    expect(evaluateCondition(cond.data.config as unknown as Condition, ctx)).toBe(false);
    const create = branch("false");
    expect(create?.data.config.integrationId).toBe("odoo::create_ticket");
    // Single-placeholder values keep their type: Odoo needs team_id as a
    // number and tag_ids as an array, not "8" and "12".
    const input = deepInterpolate(create?.data.config.input, ctx) as Record<string, unknown>;
    expect(input).toMatchObject({ name: base.name, priority: "medium", team_id: 8, tag_ids: [12] });
  });
});
