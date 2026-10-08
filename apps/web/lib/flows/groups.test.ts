import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FLOW_GROUP_ICONS,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  MAX_GROUPS,
  canonicalGroups,
  flowGroupsSchema,
  groupIssues,
  groupOfNode,
  normalizeFlowGroups,
  pruneFlowGroups,
  type FlowGroup,
} from "./groups";

const g = (id: string, nodeIds: string[], extra: Partial<FlowGroup> = {}): FlowGroup => ({
  id,
  name: `Group ${id}`,
  nodeIds,
  ...extra,
});
const nodes = ["t", "a", "b", "c", "d"];

describe("flowGroupsSchema (shape)", () => {
  it("accepts a well-formed group with optional description and icon", () => {
    const r = flowGroupsSchema.safeParse([
      g("g1", ["a", "b"], { description: "Fetch the data", icon: "Globe" }),
    ]);
    expect(r.success).toBe(true);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["a name over the limit", { name: "x".repeat(GROUP_NAME_MAX + 1) }],
    ["a description over the limit", { description: "x".repeat(GROUP_DESCRIPTION_MAX + 1) }],
    ["a description on two lines", { description: "one\ntwo" }],
    ["an icon outside the icon map", { icon: "Rocket" }],
    ["a single step", { nodeIds: ["a"] }],
    ["the same step twice", { nodeIds: ["a", "a"] }],
    ["an id with spaces", { id: "my group" }],
    ["an unknown field", { color: "red" }],
  ])("rejects %s", (_label, patch) => {
    const r = flowGroupsSchema.safeParse([{ ...g("g1", ["a", "b"]), ...patch }]);
    expect(r.success).toBe(false);
  });

  it("trims the name and the description", () => {
    const r = flowGroupsSchema.parse([
      g("g1", ["a", "b"], { name: "  Fetch  ", description: " d " }),
    ]);
    expect(r[0]).toMatchObject({ name: "Fetch", description: "d" });
  });

  it(`caps the number of groups at ${MAX_GROUPS}`, () => {
    const many = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => g(`g${i}`, ["a", "b"]));
    expect(flowGroupsSchema.safeParse(many).success).toBe(false);
  });
});

describe("groupIssues (against the flow's steps)", () => {
  it("is empty for valid groups", () => {
    expect(groupIssues([g("g1", ["a", "b"]), g("g2", ["c", "d"])], nodes)).toEqual([]);
  });

  it("rejects a member that is not a step of the flow", () => {
    const issues = groupIssues([g("g1", ["a", "ghost"])], nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("ghost");
    expect(issues[0]?.level).toBe("error");
  });

  it("rejects a step in two groups (nested groups are not supported)", () => {
    const issues = groupIssues([g("g1", ["a", "b"]), g("g2", ["b", "c"])], nodes);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "error", nodeId: "b" });
  });

  it("rejects duplicated group ids", () => {
    const issues = groupIssues([g("g1", ["a", "b"]), g("g1", ["c", "d"])], nodes);
    expect(issues.map((i) => i.message).join(" ")).toContain("g1");
  });
});

describe("normalizeFlowGroups (stored JSON is untrusted)", () => {
  it("reads anything that is not an array as no groups", () => {
    expect(normalizeFlowGroups(null)).toEqual([]);
    expect(normalizeFlowGroups({})).toEqual([]);
    expect(normalizeFlowGroups(undefined)).toEqual([]);
  });

  it("drops malformed entries and keeps the rest in canonical shape", () => {
    const out = normalizeFlowGroups([
      { nodeIds: ["a", "b"], name: "Ok", id: "g1", icon: "Globe" },
      { id: "bad", name: "", nodeIds: ["c", "d"] },
      "nope",
    ]);
    expect(out).toEqual([{ id: "g1", name: "Ok", icon: "Globe", nodeIds: ["a", "b"] }]);
    // Canonical key order, so signatures compare equal whatever the source order.
    expect(Object.keys(out[0]!)).toEqual(["id", "name", "icon", "nodeIds"]);
  });

  it("keeps the first group that claims a step and drops later overlaps", () => {
    const out = normalizeFlowGroups([g("g1", ["a", "b"]), g("g2", ["b", "c"])]);
    expect(out.map((x) => x.id)).toEqual(["g1"]);
  });
});

describe("pruneFlowGroups", () => {
  it("drops members that are no longer steps, and groups left with fewer than two", () => {
    const out = pruneFlowGroups([g("g1", ["a", "b", "x"]), g("g2", ["c", "y"])], ["a", "b", "c"]);
    expect(out).toEqual([{ id: "g1", name: "Group g1", nodeIds: ["a", "b"] }]);
  });

  it("returns the same groups when nothing changed", () => {
    const groups = [g("g1", ["a", "b"])];
    expect(pruneFlowGroups(groups, nodes)).toEqual(groups);
  });
});

describe("helpers", () => {
  it("canonicalGroups orders keys and omits empty optionals", () => {
    const out = canonicalGroups([
      { nodeIds: ["a", "b"], description: "", name: "N", id: "g1", icon: undefined },
    ] as FlowGroup[]);
    expect(out).toEqual([{ id: "g1", name: "N", nodeIds: ["a", "b"] }]);
  });

  it("groupOfNode maps each member to its group", () => {
    const map = groupOfNode([g("g1", ["a", "b"])]);
    expect(map.get("a")).toBe("g1");
    expect(map.get("c")).toBeUndefined();
  });

  it("offers a non-empty icon list without duplicates", () => {
    expect(FLOW_GROUP_ICONS.length).toBeGreaterThan(10);
    expect(new Set(FLOW_GROUP_ICONS).size).toBe(FLOW_GROUP_ICONS.length);
  });
});

describe("migration 0063", () => {
  const dbDir = resolve(__dirname, "../../../../packages/db");
  const sql = readFileSync(resolve(dbDir, "migrations/0063_flow_groups.sql"), "utf8");

  it("adds the column to flow and flow_version idempotently, with an empty default", () => {
    for (const table of ["flow", "flow_version"]) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "groups" jsonb NOT NULL DEFAULT '[]'::jsonb;`
      );
    }
  });

  it("is registered in the manifest", () => {
    const manifest = readFileSync(resolve(dbDir, "scripts/manifest.mjs"), "utf8");
    expect(manifest).toContain('"0063_flow_groups.sql"');
  });

  it("is mirrored in the drizzle schema of both tables", () => {
    const schema = readFileSync(resolve(dbDir, "src/schema/flows.ts"), "utf8");
    expect(schema.match(/groups: jsonb\("groups"\)/g)).toHaveLength(2);
  });
});
