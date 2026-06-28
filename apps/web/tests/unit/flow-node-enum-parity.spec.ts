import { it, expect, beforeAll } from "vitest";
import { vi } from "vitest";
// Remove the global vi.mock("@orchester/db") so the real schema exports are visible.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import { FLOW_NODE_TYPES } from "@/lib/flow-engine";

let dbEnumValues: readonly string[];

beforeAll(async () => {
  const { schema } = await import("@orchester/db");
  dbEnumValues = schema.flowNodeTypeEnum.enumValues;
});

it("FLOW_NODE_TYPES exactly matches the DB flow_node_type enum (set equality)", () => {
  const engine = [...FLOW_NODE_TYPES].sort();
  const db = [...dbEnumValues].sort();
  expect(engine).toEqual(db);
});
