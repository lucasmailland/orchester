import { describe, expect, it } from "vitest";
import { readAgentKbIds, withAgentKbIds } from "./knowledge-bases";

describe("agent knowledge base config", () => {
  it("reads only a clean list of string ids", () => {
    expect(readAgentKbIds({ knowledgeBaseIds: ["a", "a", 3, "", "b"] })).toEqual(["a", "b"]);
    expect(readAgentKbIds({ knowledgeBaseIds: "a" })).toEqual([]);
    expect(readAgentKbIds(null)).toEqual([]);
  });
  it("replaces the list and keeps the other config keys", () => {
    expect(withAgentKbIds({ x: 1, knowledgeBaseIds: ["a"] }, ["b"])).toEqual({
      x: 1,
      knowledgeBaseIds: ["b"],
    });
    expect(withAgentKbIds({ x: 1, knowledgeBaseIds: ["a"] }, [])).toEqual({ x: 1 });
  });
});
