import { describe, it, expect } from "vitest";
import { runInputsNeeded } from "./run-inputs";

const manual = { type: "trigger", data: { nodeId: "trigger_manual", config: {} } };
const agent = (config: Record<string, unknown> = {}) => ({
  type: "agent",
  data: { nodeId: "agent", config: { agentId: "a1", ...config } },
});

describe("runInputsNeeded", () => {
  it("asks for message when an agent step has nothing else to say", () => {
    // Without it the run modal said "no data needed" and the provider got an
    // empty user message.
    expect(runInputsNeeded([manual, agent()], {})).toEqual(["message"]);
  });

  it("does not ask when the agent step has its own prompt", () => {
    expect(runInputsNeeded([manual, agent({ prompt: "Resumí el día" })], {})).toEqual([]);
  });

  it("does not ask when the flow already defines message", () => {
    expect(runInputsNeeded([manual, agent()], { message: "hola" })).toEqual([]);
  });

  it("does not ask when there is no agent step", () => {
    expect(runInputsNeeded([manual], {})).toEqual([]);
  });

  it("tolerates nodes without config", () => {
    expect(runInputsNeeded([{ type: "agent", data: {} }], {})).toEqual(["message"]);
  });
});
