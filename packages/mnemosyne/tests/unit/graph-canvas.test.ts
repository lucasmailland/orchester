// packages/mnemosyne/tests/unit/graph-canvas.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  nodeRadius,
  ENTITY_KIND_COLOR,
  NODE_RADIUS_MIN,
  NODE_RADIUS_MAX,
} from "../../src/graph/node-canvas";
import { EDGE_STYLES } from "../../src/graph/edge-canvas";
import { RELATION_VERBS } from "../../src/graph/verbs";

describe("nodeRadius", () => {
  it("returns NODE_RADIUS_MIN when maxMentionCount is 0", () => {
    expect(nodeRadius(0, 0)).toBe(NODE_RADIUS_MIN);
  });
  it("returns NODE_RADIUS_MAX when mentionCount equals maxMentionCount", () => {
    expect(nodeRadius(10, 10)).toBe(NODE_RADIUS_MAX);
  });
  it("scales linearly — midpoint is mid-range", () => {
    const mid = nodeRadius(5, 10);
    expect(mid).toBeGreaterThan(NODE_RADIUS_MIN);
    expect(mid).toBeLessThan(NODE_RADIUS_MAX);
    expect(mid).toBeCloseTo(NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) / 2, 1);
  });
});

describe("ENTITY_KIND_COLOR", () => {
  const KINDS = [
    "person",
    "organization",
    "project",
    "concept",
    "place",
    "other",
    "episode",
    "decision",
  ];
  it.each(KINDS)("has a hex color for %s", (kind) => {
    expect(ENTITY_KIND_COLOR[kind]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("EDGE_STYLES", () => {
  it("covers every RELATION_VERB", () => {
    for (const verb of RELATION_VERBS) {
      expect(EDGE_STYLES[verb], `missing style for "${verb}"`).toBeDefined();
    }
  });
  it("conflicts_with is red and has a dash pattern", () => {
    const s = EDGE_STYLES["conflicts_with"];
    expect(s.color).toBe("#dc2626");
    expect(s.dash.length).toBeGreaterThan(0);
  });
  it("related is violet with no dash", () => {
    const s = EDGE_STYLES["related"];
    expect(s.color).toBe("#7c3aed");
    expect(s.dash).toEqual([]);
  });
});

describe("drawNode — canvas calls", () => {
  function makeMockCtx() {
    return {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      font: "",
      textAlign: "center" as CanvasTextAlign,
    } as unknown as CanvasRenderingContext2D;
  }

  it("calls beginPath and arc for a person node", async () => {
    const { drawNode } = await import("../../src/graph/node-canvas");
    const ctx = makeMockCtx();
    drawNode(ctx, {
      x: 100,
      y: 100,
      r: 16,
      color: "#7c3aed",
      selected: false,
      memoryStrength: 2.5,
      label: "Lucas",
      kind: "entity",
      entityKind: "person",
      globalScale: 1,
    });
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });

  it("applies a dash pattern when selected=true", async () => {
    const { drawNode } = await import("../../src/graph/node-canvas");
    const ctx = makeMockCtx();
    const dashes: number[][] = [];
    (ctx.setLineDash as ReturnType<typeof vi.fn>).mockImplementation((d) => dashes.push(d));
    drawNode(ctx, {
      x: 100,
      y: 100,
      r: 16,
      color: "#7c3aed",
      selected: true,
      memoryStrength: 2.5,
      label: "Lucas",
      kind: "entity",
      entityKind: "person",
      globalScale: 1,
    });
    expect(dashes.some((d) => d.length > 0)).toBe(true);
  });
});
