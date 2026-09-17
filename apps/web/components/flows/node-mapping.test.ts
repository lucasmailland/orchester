import { describe, it, expect } from "vitest";
import { toCanvasNode } from "./node-mapping";

describe("toCanvasNode", () => {
  it("carries a stored purpose onto the canvas node", () => {
    const canvas = toCanvasNode({
      id: "a",
      type: "transform",
      label: "A",
      config: { template: "{}" },
      position: { x: 1, y: 2 },
      purpose: "Shape data",
    });
    expect((canvas.data as { purpose?: string }).purpose).toBe("Shape data");
  });

  it("leaves the purpose out when the stored node has none", () => {
    const canvas = toCanvasNode({
      id: "a",
      type: "note",
      label: "A",
      config: {},
      position: { x: 0, y: 0 },
    });
    expect(canvas.data).not.toHaveProperty("purpose");
  });
});
