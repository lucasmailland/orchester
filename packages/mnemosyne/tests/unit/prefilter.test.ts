import { describe, it, expect } from "vitest";
import { shouldExtract } from "../../src/extraction/prefilter";

describe("extraction/prefilter (A1)", () => {
  it("skips when total content is too short", () => {
    const r = shouldExtract([{ role: "user", content: "hi" }]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("skips when all messages are short greetings", () => {
    const r = shouldExtract([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello! how are you" },
      { role: "user", content: "great thanks" },
    ]);
    expect(r.yes).toBe(false);
  });

  it("accepts preference indicators", () => {
    const r = shouldExtract([
      {
        role: "user",
        content: "I really prefer responses in Spanish when we discuss billing topics please",
      },
    ]);
    expect(r.yes).toBe(true);
    expect(r.reason).toBe("indicator_match");
  });

  it("accepts decision indicators", () => {
    const r = shouldExtract([
      {
        role: "assistant",
        content: "We decided to use JWT instead of session cookies for the new auth flow",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("accepts proper noun mentions", () => {
    const r = shouldExtract([
      {
        role: "user",
        content: "Daisy from Acme will be the main contact for this project moving forward okay",
      },
    ]);
    expect(r.yes).toBe(true);
  });

  it("rejects when no dialogue (only system/tool roles)", () => {
    const r = shouldExtract([
      {
        role: "system",
        content: "system instructions go here in a fairly long text block",
      },
      {
        role: "tool",
        content: "tool output result data structure with various keys and values",
      },
    ]);
    expect(r.yes).toBe(false);
    expect(r.reason).toBe("no_dialogue");
  });
});
