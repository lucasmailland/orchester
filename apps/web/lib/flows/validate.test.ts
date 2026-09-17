import { describe, it, expect } from "vitest";
import { validateFlow } from "./validate";
import { autoLayout } from "./layout";

describe("validateFlow", () => {
  it("flags a flow with no trigger", () => {
    const issues = validateFlow(
      [{ id: "a", data: { nodeId: "agent", config: { agentId: "x" } } }],
      []
    );
    expect(issues.some((i) => i.level === "error" && i.message.includes("inicio"))).toBe(true);
  });

  it("flags missing required fields", () => {
    const issues = validateFlow(
      [
        { id: "t", data: { nodeId: "trigger_manual", config: {} } },
        { id: "a", data: { nodeId: "agent", label: "Responder", config: {} } },
      ],
      [{ id: "e", source: "t", target: "a" }]
    );
    expect(issues.some((i) => i.nodeId === "a" && i.message.includes("Responder"))).toBe(true);
  });

  it("flags disconnected non-trigger nodes", () => {
    const issues = validateFlow(
      [
        { id: "t", data: { nodeId: "trigger_manual", config: {} } },
        { id: "a", data: { nodeId: "agent", label: "Suelto", config: { agentId: "x" } } },
      ],
      []
    );
    expect(issues.some((i) => i.level === "warning" && i.nodeId === "a")).toBe(true);
  });

  it("passes a complete connected flow", () => {
    const issues = validateFlow(
      [
        { id: "t", data: { nodeId: "trigger_manual", config: {} } },
        { id: "a", data: { nodeId: "agent", config: { agentId: "x" } } },
      ],
      [{ id: "e", source: "t", target: "a" }]
    );
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("documentation warnings", () => {
  const trigger = { id: "t", type: "trigger", data: { nodeId: "trigger_manual", config: {} } };
  const step = (purpose?: string) => ({
    id: "s",
    type: "transform",
    data: { nodeId: "transform", config: { template: "{}" }, ...(purpose ? { purpose } : {}) },
  });
  const edges = [{ id: "e", source: "t", target: "s" }];

  it("warns about a missing spec and a step without purpose, only when docs are checked", () => {
    expect(
      validateFlow([trigger, step()], edges).some((i) => /documentación|propósito/.test(i.message))
    ).toBe(false);
    const issues = validateFlow([trigger, step()], edges, "es", { spec: null });
    expect(
      issues
        .filter((i) => i.level === "warning")
        .map((i) => i.message)
        .join(" ")
    ).toMatch(/documentación/);
    expect(issues.some((i) => i.nodeId === "s" && /propósito/.test(i.message))).toBe(true);
    expect(
      issues.every((i) => i.level === "warning" || !/documentación|propósito/.test(i.message))
    ).toBe(true);
  });
  it("is quiet when spec and purposes are present", () => {
    const issues = validateFlow([trigger, step("Build the payload")], edges, "es", {
      spec: "## Purpose",
    });
    expect(issues.some((i) => /documentación|propósito/.test(i.message))).toBe(false);
  });
});

describe("autoLayout", () => {
  it("places nodes in increasing columns by depth", () => {
    const out = autoLayout(
      [
        { id: "t", position: { x: 0, y: 0 } },
        { id: "a", position: { x: 0, y: 0 } },
        { id: "b", position: { x: 0, y: 0 } },
      ],
      [
        { source: "t", target: "a" },
        { source: "a", target: "b" },
      ]
    );
    const x = (id: string) => out.find((n) => n.id === id)!.position.x;
    expect(x("a")).toBeGreaterThan(x("t"));
    expect(x("b")).toBeGreaterThan(x("a"));
  });

  it("handles empty input", () => {
    expect(autoLayout([], [])).toEqual([]);
  });
});
