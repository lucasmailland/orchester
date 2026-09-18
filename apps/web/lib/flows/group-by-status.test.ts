import { describe, expect, it } from "vitest";
import { groupFlowsByStatus } from "./group-by-status";

describe("groupFlowsByStatus", () => {
  it("orders groups by active, paused, draft while preserving input order within each group", () => {
    const flows = [
      { id: "draft-new", status: "draft" as const },
      { id: "active-new", status: "active" as const },
      { id: "paused-new", status: "paused" as const },
      { id: "active-old", status: "active" as const },
      { id: "draft-old", status: "draft" as const },
      { id: "paused-old", status: "paused" as const },
    ];
    const original = [...flows];

    expect(groupFlowsByStatus(flows)).toEqual([
      { status: "active", flows: [flows[1], flows[3]] },
      { status: "paused", flows: [flows[2], flows[5]] },
      { status: "draft", flows: [flows[0], flows[4]] },
    ]);
    expect(flows).toEqual(original);
  });

  it.each(["active", "paused", "draft"] as const)(
    "omits empty groups with only %s flows",
    (status) => {
      const flows = [{ id: "test-flow", status }];
      expect(groupFlowsByStatus(flows)).toEqual([{ status, flows }]);
    }
  );

  it("returns no groups for an empty workspace", () => {
    expect(groupFlowsByStatus([])).toEqual([]);
  });
});
