import { describe, it, expect } from "vitest";
import { buildAgentUserMessage } from "@/lib/flow-engine";

describe("buildAgentUserMessage", () => {
  it("uses the incoming message", () => {
    expect(buildAgentUserMessage({}, { message: "hola" })).toBe("hola");
  });

  it("puts the step prompt before the incoming message", () => {
    expect(buildAgentUserMessage({ prompt: "Clasificá:" }, { message: "hola" })).toBe(
      "Clasificá:\n\nhola"
    );
  });

  it("works with only a prompt", () => {
    expect(buildAgentUserMessage({ prompt: "Resumí el día" }, {})).toBe("Resumí el día");
  });

  it("refuses to send an empty message to the provider", () => {
    // Bedrock answers 400 "user messages must have non-empty content", which
    // says nothing about the flow. Fail here, in the step, with what to fix.
    expect(() => buildAgentUserMessage({}, {})).toThrow(/message/);
    expect(() => buildAgentUserMessage({ message: "  {{nada}} " }, {})).toThrow(/message/);
  });
});
