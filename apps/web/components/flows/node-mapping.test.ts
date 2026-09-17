import { describe, it, expect } from "vitest";
import { toCanvasNode, toStoredNode } from "./node-mapping";

describe("purpose survives load → edit → save", () => {
  it("round-trips", () => {
    const stored = {
      id: "a",
      type: "transform",
      label: "A",
      config: { template: "{}" },
      position: { x: 1, y: 2 },
      purpose: "Shape data",
    };
    const canvas = toCanvasNode(stored);
    expect((canvas.data as { purpose?: string }).purpose).toBe("Shape data");
    const edited = { ...canvas, data: { ...canvas.data, purpose: "Build the payload" } };
    expect(toStoredNode(edited)).toEqual({ ...stored, purpose: "Build the payload" });
  });
  it("omits an empty purpose", () => {
    const canvas = toCanvasNode({
      id: "a",
      type: "note",
      label: "A",
      config: {},
      position: { x: 0, y: 0 },
    });
    expect(toStoredNode(canvas)).not.toHaveProperty("purpose");
  });
});
