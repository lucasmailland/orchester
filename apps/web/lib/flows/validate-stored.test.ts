import { describe, it, expect } from "vitest";
import { validateStoredFlow, hasErrors } from "./validate-stored";

const trigger = {
  id: "t",
  type: "trigger",
  label: "Start",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
  purpose: "Start by hand",
};
const transform = (id: string, template: unknown, purpose = "Shape data") => ({
  id,
  type: "transform",
  label: id,
  config: { template },
  position: { x: 0, y: 0 },
  purpose,
});

describe("validateStoredFlow", () => {
  it("validates flat stored nodes like the editor does", () => {
    const missing = {
      id: "a",
      type: "agent",
      label: "A",
      config: {},
      position: { x: 0, y: 0 },
      purpose: "Answer",
    };
    const issues = validateStoredFlow([trigger, missing], [{ id: "e", source: "t", target: "a" }], {
      spec: "x",
    });
    expect(issues.some((i) => i.level === "error" && i.nodeId === "a")).toBe(true);
  });
  it("rejects unknown raw types before normalization hides them", () => {
    const issues = validateStoredFlow([trigger, { id: "z", type: "teleport", config: {} }], [], {
      spec: "x",
    });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.find((i) => i.nodeId === "z")?.message).toMatch(/teleport/);
  });
  it("accepts legacy types that have an equivalent", () => {
    const issues = validateStoredFlow([trigger, { id: "b", type: "branch", config: {} }], [], {
      spec: "x",
    });
    expect(issues.some((i) => i.nodeId === "b" && /teleport|desconocido/.test(i.message))).toBe(
      false
    );
  });
  it("reports bad filters in any config string as errors", () => {
    const issues = validateStoredFlow(
      [trigger, transform("x", { a: "{{b | nope}}" })],
      [{ id: "e", source: "t", target: "x" }],
      {
        spec: "x",
      }
    );
    expect(
      issues.some((i) => i.level === "error" && i.nodeId === "x" && /nope/.test(i.message))
    ).toBe(true);
  });
  it("allows done edges only from try_catch, parallel and loop_for_each", () => {
    const bad = validateStoredFlow(
      [trigger, transform("x", "{}"), transform("y", "{}")],
      [
        { id: "e1", source: "t", target: "x" },
        { id: "e2", source: "x", target: "y", sourceHandle: "done" },
      ],
      { spec: "x" }
    );
    expect(bad.some((i) => i.level === "error" && /done/.test(i.message))).toBe(true);
    const ok = validateStoredFlow(
      [
        trigger,
        {
          id: "tc",
          type: "try_catch",
          label: "tc",
          config: {},
          position: { x: 0, y: 0 },
          purpose: "p",
        },
        transform("y", "{}"),
      ],
      [
        { id: "e1", source: "t", target: "tc" },
        { id: "e2", source: "tc", target: "y", sourceHandle: "done" },
      ],
      { spec: "x" }
    );
    expect(ok.some((i) => /done/.test(i.message))).toBe(false);
  });
  it("returns documentation warnings, never errors, for missing spec and purpose", () => {
    const issues = validateStoredFlow(
      [trigger, transform("x", "{}", "")],
      [{ id: "e", source: "t", target: "x" }],
      {}
    );
    expect(
      issues
        .filter((i) => /documentación|propósito/.test(i.message))
        .every((i) => i.level === "warning")
    ).toBe(true);
    expect(issues.some((i) => /documentación/.test(i.message))).toBe(true);
  });
  it("accepts an empty graph", () => {
    expect(hasErrors(validateStoredFlow([], [], {}))).toBe(false);
  });
});
