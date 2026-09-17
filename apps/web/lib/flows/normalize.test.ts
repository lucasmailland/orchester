import { describe, it, expect } from "vitest";
import { normalizeFlowNodes, normalizeFlowEdges } from "./normalize";

// Exactly what the Compass "Support Triage" template stored — and what makes
// the editor crash on `node.config.agentId` every time the flow is opened.
const legacySupportTriage = [
  { id: "n1", type: "trigger", position: { x: 80, y: 160 }, data: { label: "Inbound message" } },
  { id: "n2", type: "tool", position: { x: 320, y: 160 }, data: { label: "Search KB" } },
  { id: "n3", type: "agent", position: { x: 560, y: 160 }, data: { label: "Support agent" } },
  { id: "n4", type: "branch", position: { x: 800, y: 160 }, data: { label: "Confidence ok?" } },
  {
    id: "n5",
    type: "handoff",
    position: { x: 1040, y: 260 },
    data: { label: "Escalate to human" },
  },
];

describe("normalizeFlowNodes", () => {
  it("turns the legacy template shape into node types the editor knows", () => {
    const out = normalizeFlowNodes(legacySupportTriage);
    expect(out.map((n) => n.type)).toEqual(["trigger", "note", "agent", "condition", "wait_human"]);
  });

  it("gives every node a label and a config object", () => {
    for (const n of normalizeFlowNodes(legacySupportTriage)) {
      expect(typeof n.label).toBe("string");
      expect(n.label).not.toBe("");
      expect(n.config).toBeTypeOf("object");
      expect(n.config).not.toBeNull();
    }
  });

  it("keeps the label each legacy step was given", () => {
    expect(normalizeFlowNodes(legacySupportTriage).map((n) => n.label)).toEqual([
      "Inbound message",
      "Search KB",
      "Support agent",
      "Confidence ok?",
      "Escalate to human",
    ]);
  });

  it("starts a legacy trigger as a manual start", () => {
    expect(normalizeFlowNodes(legacySupportTriage)[0]!.config.triggerKind).toBe("manual");
  });

  it("turns a step with no equivalent into a note that names it, instead of guessing", () => {
    const note = normalizeFlowNodes(legacySupportTriage)[1]!;
    expect(String(note.config.text)).toContain("Search KB");
    expect(String(note.config.text)).toContain("tool");
  });

  it("keeps positions", () => {
    expect(normalizeFlowNodes(legacySupportTriage)[4]!.position).toEqual({ x: 1040, y: 260 });
  });

  it("leaves a valid stored node exactly as it is", () => {
    const valid = {
      id: "a",
      type: "agent",
      label: "Responder",
      config: { agentId: "x" },
      position: { x: 1, y: 2 },
    };
    expect(normalizeFlowNodes([valid])).toEqual([valid]);
  });

  it("is idempotent", () => {
    const once = normalizeFlowNodes(legacySupportTriage);
    expect(normalizeFlowNodes(once)).toEqual(once);
  });

  it("gives a node without id or position usable ones", () => {
    const [n] = normalizeFlowNodes([{ type: "agent", label: "A", config: {} }]);
    expect(n!.id).toBeTruthy();
    expect(n!.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });

  it("drops entries that are not nodes and tolerates a missing list", () => {
    expect(normalizeFlowNodes([null, 3, "x"])).toEqual([]);
    expect(normalizeFlowNodes(undefined)).toEqual([]);
  });
});

describe("normalizeFlowEdges", () => {
  it("keeps source, target, branch handle and label", () => {
    expect(
      normalizeFlowEdges([{ id: "e", source: "a", target: "b", sourceHandle: "true", label: "sí" }])
    ).toEqual([{ id: "e", source: "a", target: "b", sourceHandle: "true", label: "sí" }]);
  });

  it("gives an edge without id one", () => {
    const [e] = normalizeFlowEdges([{ source: "a", target: "b" }]);
    expect(e!.id).toBeTruthy();
  });

  it("drops entries that are not edges", () => {
    expect(normalizeFlowEdges([null, { source: "a" }, { target: "b" }])).toEqual([]);
    expect(normalizeFlowEdges(undefined)).toEqual([]);
  });
});

describe("purpose", () => {
  it("keeps a one-line purpose from the stored node or legacy data", () => {
    const out = normalizeFlowNodes([
      {
        id: "a",
        type: "note",
        label: "A",
        config: {},
        position: { x: 0, y: 0 },
        purpose: "Explain the flow",
      },
      { id: "b", type: "note", data: { label: "B", purpose: "line one\nline two" } },
    ]);
    expect(out[0]!.purpose).toBe("Explain the flow");
    expect(out[1]!.purpose).toBe("line one line two");
  });
  it("truncates past 280 characters and drops empty purposes", () => {
    const out = normalizeFlowNodes([
      { id: "a", type: "note", config: {}, purpose: "x".repeat(300) },
      { id: "b", type: "note", config: {}, purpose: "   " },
    ]);
    expect(out[0]!.purpose).toHaveLength(280);
    expect(out[1]).not.toHaveProperty("purpose");
  });
});
