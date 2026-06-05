// packages/mnemosyne/tests/unit/graph-query.test.ts
import { describe, it, expect } from "vitest";
import { buildGraphData } from "../../src/graph/query";

const baseEntities = [
  {
    id: "e1",
    workspaceId: "ws1",
    name: "Lucas",
    kind: "person",
    description: null,
    mentionCount: 5,
    canonicalId: null,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "e2",
    workspaceId: "ws1",
    name: "Fichap",
    kind: "organization",
    description: null,
    mentionCount: 3,
    canonicalId: null,
    createdAt: new Date("2026-01-01"),
  },
  {
    id: "e3",
    workspaceId: "ws1",
    name: "Merged",
    kind: "person",
    description: null,
    mentionCount: 1,
    canonicalId: "e1",
    createdAt: new Date("2026-01-01"),
  },
];
const baseRelations = [
  {
    id: "r1",
    sourceId: "e1",
    sourceKind: "entity",
    targetId: "e2",
    targetKind: "entity",
    relation: "member_of",
    confidence: 0.9,
    provenance: null,
  },
];
const baseFactStats = [
  { entityId: "e1", factCount: 8, avgMemoryStrength: 3.2 },
  { entityId: "e2", factCount: 2, avgMemoryStrength: 1.5 },
];

describe("buildGraphData", () => {
  it("excludes entities with a canonicalId (merged)", () => {
    const result = buildGraphData(baseEntities, [], [], baseFactStats, baseRelations, {});
    expect(result.nodes.map((n) => n.id)).not.toContain("e3");
    expect(result.meta.entityCount).toBe(2);
  });

  it("maps fact stats onto entity nodes correctly", () => {
    const result = buildGraphData(baseEntities, [], [], baseFactStats, baseRelations, {});
    const lucas = result.nodes.find((n) => n.id === "e1");
    expect(lucas?.factCount).toBe(8);
    expect(lucas?.avgMemoryStrength).toBeCloseTo(3.2, 1);
  });

  it("defaults avgMemoryStrength to 1.0 when no facts", () => {
    const result = buildGraphData(baseEntities, [], [], [], baseRelations, {});
    const lucas = result.nodes.find((n) => n.id === "e1");
    expect(lucas?.avgMemoryStrength).toBe(1.0);
  });

  it("limits to 1-hop neighborhood when focusEntityId provided", () => {
    const result = buildGraphData(baseEntities, [], [], baseFactStats, baseRelations, {
      focusEntityId: "e1",
    });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("e1");
    expect(ids).toContain("e2");
    expect(result.meta.entityCount).toBe(2);
  });

  it("maps episode nodes with factCount from linkedFactIds.length", () => {
    const episodes = [
      {
        id: "ep1",
        workspaceId: "ws1",
        title: "Sprint Planning",
        isSynthetic: false,
        linkedFactIds: ["f1", "f2", "f3"],
        createdAt: new Date("2026-03-01"),
      },
    ];
    const result = buildGraphData(baseEntities, episodes, [], baseFactStats, [], {});
    const ep = result.nodes.find((n) => n.id === "ep1");
    expect(ep?.kind).toBe("episode");
    expect(ep?.label).toBe("Sprint Planning");
    expect(ep?.factCount).toBe(3);
    expect(result.meta.episodeCount).toBe(1);
  });

  it("maps decision nodes with kind='decision'", () => {
    const decisions = [
      {
        id: "d1",
        workspaceId: "ws1",
        title: "Use TypeScript everywhere",
        status: "active",
        createdAt: new Date("2026-02-01"),
      },
    ];
    const result = buildGraphData(baseEntities, [], decisions, baseFactStats, [], {});
    const dec = result.nodes.find((n) => n.id === "d1");
    expect(dec?.kind).toBe("decision");
    expect(dec?.label).toBe("Use TypeScript everywhere");
    expect(result.meta.decisionCount).toBe(1);
  });
});
