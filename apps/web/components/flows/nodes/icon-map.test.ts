import { describe, it, expect } from "vitest";
import { NODE_ICONS } from "./icon-map";
import { FLOW_GROUP_ICONS } from "@/lib/flows/groups";

describe("group icons", () => {
  it("are exactly the names of the step icon map", () => {
    // The server validates group icons without importing lucide; the list it
    // uses must not drift from the icons the editor can draw.
    expect([...FLOW_GROUP_ICONS].sort()).toEqual(Object.keys(NODE_ICONS).sort());
  });
});
