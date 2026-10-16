// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCall, type LlmCallParams } from "@/lib/llm-call";
import {
  DEFAULT_MAX_TOKENS,
  OUTPUT_LIMIT_REFUSAL_PREFIX,
  outputLimitRefusal,
} from "@/lib/ai/output-limit";

const h = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: { aiProviders: { workspaceId: "workspaceId", provider: "provider" } },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "test-key" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: h.log }));

const fetchMock = vi.fn<typeof fetch>();
const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [
          { enabled: true, apiKey: "encrypted-test-key", endpoint: "https://example.test" },
        ],
      }),
    }),
  }),
};
const params = (model: string, overrides: Partial<LlmCallParams> = {}): LlmCallParams => ({
  workspaceId: "test-workspace",
  model,
  systemPrompt: "System",
  messages: [{ role: "user", content: "Write the note" }],
  tx: tx as unknown as NonNullable<LlmCallParams["tx"]>,
  ...overrides,
});

const openAiLike = (finish: string) => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [
          {
            id: "t1",
            type: "function",
            function: { name: "post_note", arguments: '{"task_id":7,"bo' },
          },
        ],
      },
      finish_reason: finish,
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 1024, total_tokens: 1034 },
});

// Each provider names "the reply reached max tokens" its own way.
const providers: Array<[string, string, (cut: boolean) => unknown]> = [
  [
    "Anthropic",
    "anthropic:claude-sonnet-4-5",
    (cut) => ({
      content: [{ type: "tool_use", id: "t1", name: "post_note", input: { task_id: 7 } }],
      stop_reason: cut ? "max_tokens" : "tool_use",
      usage: { input_tokens: 10, output_tokens: 1024 },
    }),
  ],
  [
    "Bedrock Converse",
    "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0",
    (cut) => ({
      output: {
        message: {
          content: [{ toolUse: { toolUseId: "t1", name: "post_note", input: { task_id: 7 } } }],
        },
      },
      stopReason: cut ? "max_tokens" : "tool_use",
      usage: { inputTokens: 10, outputTokens: 1024 },
    }),
  ],
  ["OpenAI-compatible", "openai:gpt-4o", (cut) => openAiLike(cut ? "length" : "tool_calls")],
  [
    "Google",
    "google:gemini-2.5-flash",
    (cut) => ({
      candidates: [
        { content: { parts: [{ text: "Partial" }] }, finishReason: cut ? "MAX_TOKENS" : "STOP" },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1024 },
    }),
  ],
  [
    "Azure OpenAI",
    "azure_openai:support-deployment",
    (cut) => ({
      choices: [{ message: { content: "Partial" }, finish_reason: cut ? "length" : "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 1024, total_tokens: 1034 },
    }),
  ],
];

beforeEach(() => {
  fetchMock.mockReset();
  h.log.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const warned = () =>
  h.log.mock.calls.filter(([level, message]) => level === "warn" && /output limit/.test(message));

describe.each(providers)("%s", (_name, model, reply) => {
  it("marks a reply cut at the output limit and logs it", async () => {
    fetchMock.mockResolvedValue(Response.json(reply(true)));
    const result = await llmCall(params(model));
    expect(result.truncated).toBe(true);
    expect(warned()).toHaveLength(1);
    expect(warned()[0]![2]).toMatchObject({ model, maxTokens: DEFAULT_MAX_TOKENS });
  });

  it("logs the limit the call asked for", async () => {
    fetchMock.mockResolvedValue(Response.json(reply(true)));
    await llmCall(params(model, { maxTokens: 300 }));
    expect(warned()[0]![2]).toMatchObject({ maxTokens: 300 });
  });

  it("leaves a reply that ended on its own unmarked", async () => {
    fetchMock.mockResolvedValue(Response.json(reply(false)));
    const result = await llmCall(params(model));
    expect(result).not.toHaveProperty("truncated");
    expect(warned()).toHaveLength(0);
  });
});

describe("outputLimitRefusal", () => {
  it("names the limit, starts with the refusal prefix and asks for a shorter call", () => {
    const text = outputLimitRefusal(4096);
    expect(text.startsWith(OUTPUT_LIMIT_REFUSAL_PREFIX)).toBe(true);
    expect(text).toContain("4096 tokens");
    expect(text).toMatch(/none of them ran/);
    expect(text).toMatch(/shorter input/);
  });

  it("falls back to the default limit when the agent sets none", () => {
    expect(outputLimitRefusal(null)).toContain(`${DEFAULT_MAX_TOKENS} tokens`);
    expect(outputLimitRefusal(undefined)).toContain(`${DEFAULT_MAX_TOKENS} tokens`);
  });
});
