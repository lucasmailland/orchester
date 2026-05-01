import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: {},
}));
vi.mock("../lib/llm-call", () => ({
  llmCall: vi.fn(async () => ({ content: "ok", tokensUsed: 5, model: "claude-haiku-4-5" })),
}));

import { evaluateCondition, interpolate } from "../lib/flow-engine";

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
