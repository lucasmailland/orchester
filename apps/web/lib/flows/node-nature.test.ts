import { describe, it, expect } from "vitest";
import { FLOW_NODE_TYPES } from "./node-types";
import {
  NODE_NATURE,
  nodeNature,
  summarizeFlowNature,
  summarizeFlowNatureTransitive,
  type NatureFlow,
} from "./node-nature";

describe("nodeNature", () => {
  it("classifies every FlowNodeType (exhaustive)", () => {
    for (const type of FLOW_NODE_TYPES) {
      expect(["ai", "code", "human", "control"], type).toContain(nodeNature({ type }));
    }
    // No stale entries either.
    expect(Object.keys(NODE_NATURE).sort()).toEqual([...FLOW_NODE_TYPES].sort());
  });

  it("marks every model-calling handler as ai", () => {
    for (const type of [
      "agent",
      "llm_prompt",
      "kb_search",
      "generate_image",
      "embed_text",
      "generate_video",
      "text_to_speech",
      "transcribe",
      "rerank",
      "generate_avatar",
      "generate_music",
      "ocr_extract",
    ]) {
      expect(nodeNature({ type }), type).toBe("ai");
    }
  });

  it("keeps integration, http and subflow as code", () => {
    for (const type of ["integration", "http", "subflow", "transform", "code", "delay", "notify"]) {
      expect(nodeNature({ type }), type).toBe("code");
    }
  });

  it("classifies human and control nodes", () => {
    expect(nodeNature({ type: "wait_human" })).toBe("human");
    for (const type of [
      "trigger",
      "condition",
      "switch",
      "loop_for_each",
      "parallel",
      "try_catch",
      "end",
    ]) {
      expect(nodeNature({ type }), type).toBe("control");
    }
  });

  it("treats an unknown stored type as code, not as ai", () => {
    expect(nodeNature({ type: "from_the_future" })).toBe("code");
  });
});

describe("summarizeFlowNature", () => {
  it("counts per nature and lists the AI nodes", () => {
    const s = summarizeFlowNature([
      { id: "a", type: "trigger", label: "Start" },
      { id: "b", type: "llm_prompt", label: "Summarize" },
      { id: "c", type: "agent" },
      { id: "d", type: "http", label: "Call" },
      { id: "e", type: "wait_human", label: "Approve" },
    ]);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ ai: 2, code: 1, human: 1, control: 1 });
    expect(s.aiNodes).toEqual([
      { id: "b", label: "Summarize" },
      { id: "c", label: "c" },
    ]);
  });

  it("handles an empty flow", () => {
    const s = summarizeFlowNature([]);
    expect(s.total).toBe(0);
    expect(s.counts.ai).toBe(0);
  });
});

describe("summarizeFlowNatureTransitive", () => {
  const flows: NatureFlow[] = [
    { id: "root", nodes: [{ id: "s", type: "subflow", config: { flowId: "mid" } }] },
    { id: "mid", nodes: [{ id: "s", type: "subflow", config: { flowId: "leaf" } }] },
    { id: "leaf", nodes: [{ id: "l", type: "llm_prompt" }] },
    { id: "plain", nodes: [{ id: "h", type: "http" }] },
    { id: "callsPlain", nodes: [{ id: "s", type: "subflow", config: { flowId: "plain" } }] },
    { id: "loopA", nodes: [{ id: "s", type: "subflow", config: { flowId: "loopB" } }] },
    {
      id: "loopB",
      nodes: [
        { id: "s", type: "subflow", config: { flowId: "loopA" } },
        { id: "m", type: "agent" },
      ],
    },
    { id: "cycleNoAi", nodes: [{ id: "s", type: "subflow", config: { flowId: "cycleNoAi" } }] },
    { id: "dangling", nodes: [{ id: "s", type: "subflow", config: { flowId: "missing" } }] },
  ];

  it("reaches AI through nested subflows", () => {
    const s = summarizeFlowNatureTransitive("root", flows);
    expect(s.counts.ai).toBe(0);
    expect(s.reachesAi).toBe(true);
    expect(s.aiSubflowNodeIds).toEqual(["s"]);
  });

  it("does not flag a subflow that only reaches code", () => {
    const s = summarizeFlowNatureTransitive("callsPlain", flows);
    expect(s.reachesAi).toBe(false);
    expect(s.aiSubflowNodeIds).toEqual([]);
  });

  it("terminates on cycles and still finds AI inside them", () => {
    expect(summarizeFlowNatureTransitive("loopA", flows).reachesAi).toBe(true);
    expect(summarizeFlowNatureTransitive("cycleNoAi", flows).reachesAi).toBe(false);
  });

  it("ignores subflows that point at missing flows", () => {
    expect(summarizeFlowNatureTransitive("dangling", flows).reachesAi).toBe(false);
  });

  it("reports direct AI as reaching AI", () => {
    expect(summarizeFlowNatureTransitive("leaf", flows).reachesAi).toBe(true);
  });
});
