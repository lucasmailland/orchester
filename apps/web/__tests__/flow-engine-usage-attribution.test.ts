import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

// Every flow step that calls a model tells the AI layer which flow, run and
// step it is, so its usage row can be traced back to them.

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const ai = vi.hoisted(() => ({
  runChat: vi.fn(async () => ({ content: "ok", tokensUsed: 5, model: "m" })),
  generateImage: vi.fn(async () => ({ images: [{ url: "https://img.test/a.png" }] })),
  embed: vi.fn(async () => ({ vectors: [[0.1]] })),
  generateVideo: vi.fn(async () => ({ url: "https://media.test/v.mp4" })),
  textToSpeech: vi.fn(async () => ({ url: "https://media.test/s.mp3" })),
  transcribe: vi.fn(async () => ({ text: "hello" })),
  generateAvatar: vi.fn(async () => ({ url: "https://media.test/a.mp4" })),
  generateMusic: vi.fn(async () => ({ url: "https://media.test/m.mp3" })),
  ocr: vi.fn(async () => ({ text: "page" })),
  rerank: vi.fn(async () => ({ results: [] })),
}));
vi.mock("@/lib/ai/run", () => ({
  ...ai,
  chargeFor: () => ({ tokensIn: 2, tokensOut: 3, tokensTotal: 5, costUsd: 0 }),
  recordAiUsage: vi.fn(),
}));

const steps: Array<[string, keyof typeof ai, Record<string, unknown>]> = [
  ["llm_prompt", "runChat", { prompt: "Summarize" }],
  ["generate_image", "generateImage", { prompt: "A cat" }],
  ["embed_text", "embed", { input: "text" }],
  ["generate_video", "generateVideo", { prompt: "A wave" }],
  ["text_to_speech", "textToSpeech", { text: "Hello" }],
  ["transcribe", "transcribe", { audioUrl: "https://media.test/in.mp3" }],
  ["generate_avatar", "generateAvatar", { text: "Hello" }],
  ["generate_music", "generateMusic", { prompt: "Calm" }],
  ["ocr_extract", "ocr", { documentUrl: "https://media.test/doc.pdf" }],
  ["rerank", "rerank", { query: "q", documents: ["a", "b"] }],
];

beforeEach(() => vi.clearAllMocks());

describe("flow step usage attribution", () => {
  it.each(steps)("%s passes flow, run and step", async (type, helper, config) => {
    const result = await runFlowGraph(
      [
        { id: "t", type: "trigger", label: "t", config: {}, position: { x: 0, y: 0 } },
        {
          id: "step",
          type,
          label: "step",
          config: { model: "provider:model", ...config },
          position: { x: 0, y: 0 },
        },
      ],
      [{ id: "e", source: "t", target: "step" }]
    );
    expect(result.status).toBe("succeeded");
    const call = (ai[helper].mock.calls as unknown[][])[0]!;
    const attribution = { flowId: "flow_test", flowRunId: result.runId, nodeId: "step" };
    expect(call.at(-1)).toEqual(helper === "runChat" ? { attribution } : attribution);
  });
});
