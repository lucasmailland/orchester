import { describe, it, expect } from "vitest";
import { NODE_REGISTRY, getNodeDef, listNodesByCategory, CATEGORY_LABELS } from "./node-registry";

describe("node-registry", () => {
  it("every node has id, engine, category, trilingual copy and fields", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      expect(def.id).toBeTruthy();
      expect(def.engine).toBeTruthy();
      expect(def.category).toBeTruthy();
      expect(def.title.es && def.title.en && def.title["pt"]).toBeTruthy();
      expect(def.summary.es && def.summary.en && def.summary["pt"]).toBeTruthy();
      expect(Array.isArray(def.fields)).toBe(true);
    }
  });

  it("registry id matches the map key", () => {
    for (const [key, def] of Object.entries(NODE_REGISTRY)) {
      expect(def.id).toBe(key);
    }
  });

  it("has the agent node with an agent-picker field", () => {
    const agent = getNodeDef("agent");
    expect(agent?.fields.some((f) => f.type === "agent-picker")).toBe(true);
  });

  it("has at least 18 nodes including new ones", () => {
    expect(Object.keys(NODE_REGISTRY).length).toBeGreaterThanOrEqual(18);
    expect(getNodeDef("integration")).toBeTruthy();
    expect(getNodeDef("kb_search")).toBeTruthy();
    expect(getNodeDef("spreadsheet")).toBeTruthy();
    expect(getNodeDef("trigger_webhook")).toBeTruthy();
  });

  it("groups nodes by category with labels", () => {
    const groups = listNodesByCategory();
    expect(groups.find((g) => g.category === "trigger")).toBeTruthy();
    expect(groups.find((g) => g.category === "apps")).toBeTruthy();
    for (const g of groups) {
      expect(CATEGORY_LABELS[g.category].es).toBeTruthy();
    }
  });

  it("required fields have labels and most fields have help text", () => {
    for (const def of Object.values(NODE_REGISTRY)) {
      for (const f of def.fields) {
        expect(f.label).toBeTruthy();
      }
    }
  });
});
