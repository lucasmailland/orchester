import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: {},
}));
vi.mock("../lib/llm-call", () => ({
  llmCall: vi.fn(async () => ({ content: "ok", tokensUsed: 5, model: "claude-haiku-4-5" })),
}));

import {
  evaluateCondition,
  interpolate,
  resolveValue,
  deepInterpolate,
  parseDuration,
} from "../lib/flow-engine";

describe("interpolate", () => {
  it("replaces {{var}} from context", () => {
    expect(interpolate("Hello {{name}}", { name: "Lucas" })).toBe("Hello Lucas");
  });
  it("supports nested paths", () => {
    expect(interpolate("{{user.email}}", { user: { email: "x@y" } })).toBe("x@y");
  });
  it("leaves unknown vars as empty string", () => {
    expect(interpolate("Hello {{missing}}", {})).toBe("Hello ");
  });
});

describe("evaluateCondition", () => {
  it("equals", () => {
    expect(evaluateCondition({ left: "{{a}}", op: "==", right: "1" }, { a: "1" })).toBe(true);
    expect(evaluateCondition({ left: "{{a}}", op: "==", right: "2" }, { a: "1" })).toBe(false);
  });
  it("contains", () => {
    expect(
      evaluateCondition({ left: "{{a}}", op: "contains", right: "lo" }, { a: "hello" })
    ).toBe(true);
  });
  it("gt for numbers", () => {
    expect(evaluateCondition({ left: "{{a}}", op: ">", right: "5" }, { a: "10" })).toBe(true);
  });
});

describe("resolveValue", () => {
  it("returns the real value (array) for a single {{path}}", () => {
    expect(resolveValue("{{list}}", { list: [1, 2, 3] })).toEqual([1, 2, 3]);
  });
  it("interpolates to string when mixed with text", () => {
    expect(resolveValue("n={{x}}", { x: 5 })).toBe("n=5");
  });
  it("returns non-strings unchanged", () => {
    expect(resolveValue(42, {})).toBe(42);
  });
});

describe("deepInterpolate", () => {
  it("interpolates nested object/array values keeping types", () => {
    const out = deepInterpolate(
      { name: "{{n}}", items: "{{list}}", nested: { x: "{{x}}" } },
      { n: "Lucas", list: [1, 2], x: 7 }
    );
    expect(out).toEqual({ name: "Lucas", items: [1, 2], nested: { x: 7 } });
  });
});

describe("parseDuration", () => {
  it("parses unit suffixes", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });
  it("passes numbers through as ms", () => {
    expect(parseDuration(1500)).toBe(1500);
  });
  it("returns 0 for garbage", () => {
    expect(parseDuration("abc")).toBe(0);
  });
});
