// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCall, type LlmCallParams } from "@/lib/llm-call";
import type { ChatMessage } from "@/lib/ai/capabilities";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: { aiProviders: { workspaceId: "workspaceId", provider: "provider" } },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "test-key" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));

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
  messages: [{ role: "user", content: "Hello" }],
  tx: tx as unknown as NonNullable<LlmCallParams["tx"]>,
  ...overrides,
});
function body() {
  const [, init] = fetchMock.mock.calls[0]!;
  return JSON.parse(init!.body as string);
}
/** Every cache marker in a request body, wherever it is. */
function markers(value: unknown): number {
  const json = JSON.stringify(value);
  return (json.match(/"cache_control"|"cachePoint"/g) ?? []).length;
}

// A tool loop after one round: the question, the model's tool call, its result.
const loop: ChatMessage[] = [
  { role: "user", content: "Look into task 7" },
  {
    role: "assistant",
    content: "Reading it.",
    toolCalls: [{ id: "t1", name: "odoo_get_task", input: { task_id: 7 } }],
  },
  {
    role: "tool",
    content: "",
    toolResults: [{ id: "t1", name: "odoo_get_task", input: { task_id: 7 }, output: { id: 7 } }],
  },
];

const ANTHROPIC = "anthropic:claude-sonnet-4-5";
const BEDROCK_CLAUDE = "bedrock:us.anthropic.claude-sonnet-4-6";

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("anthropic.com")) {
      return Response.json({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    }
    if (u.includes("bedrock")) {
      return Response.json({
        output: { message: { content: [{ text: "ok" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 2 },
      });
    }
    return Response.json({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("cacheMessages on the Anthropic API", () => {
  it("marks the last block of the last message, and nothing before it", async () => {
    await llmCall(params(ANTHROPIC, { messages: loop, cacheMessages: true }));
    const messages = body().messages;
    const last = messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content.at(-1)).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      cache_control: { type: "ephemeral" },
    });
    expect(markers(messages.slice(0, -1))).toBe(0);
    expect(markers(messages)).toBe(1);
  });

  it("marks only the last of several tool results", async () => {
    const results = [1, 2].map((n) => ({
      id: `t${n}`,
      name: "odoo_get_task",
      input: { task_id: n },
      output: { id: n },
    }));
    await llmCall(
      params(ANTHROPIC, {
        messages: [...loop.slice(0, 2), { role: "tool", content: "", toolResults: results }],
        cacheMessages: true,
      })
    );
    const [first, second] = body().messages.at(-1).content;
    expect(first).not.toHaveProperty("cache_control");
    expect(second).toMatchObject({ tool_use_id: "t2", cache_control: { type: "ephemeral" } });
  });

  it("turns a plain last message into a marked text block", async () => {
    await llmCall(params(ANTHROPIC, { cacheMessages: true }));
    expect(body().messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }],
      },
    ]);
  });

  it("leaves an empty last message alone, since an empty text block is refused", async () => {
    await llmCall(
      params(ANTHROPIC, {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "" },
        ],
        cacheMessages: true,
      })
    );
    expect(markers(body().messages)).toBe(0);
  });

  it("keeps the system checkpoint, for two markers in all", async () => {
    await llmCall(
      params(ANTHROPIC, { messages: loop, cacheMessages: true, systemPromptCacheBoundary: 6 })
    );
    const b = body();
    expect(b.system).toEqual([
      { type: "text", text: "System", cache_control: { type: "ephemeral" } },
    ]);
    expect(markers(b)).toBe(2);
  });

  it("sends the messages unmarked without cacheMessages", async () => {
    await llmCall(params(ANTHROPIC, { messages: loop }));
    expect(markers(body())).toBe(0);
    expect(body().messages[0]).toEqual({ role: "user", content: "Look into task 7" });
  });
});

describe("cacheMessages on Bedrock Converse", () => {
  it("adds a checkpoint after the last message's blocks, and nowhere before", async () => {
    await llmCall(params(BEDROCK_CLAUDE, { messages: loop, cacheMessages: true }));
    const messages = body().messages;
    const last = messages.at(-1);
    expect(last.content).toHaveLength(2);
    expect(last.content[0]).toHaveProperty("toolResult.toolUseId", "t1");
    expect(last.content[1]).toEqual({ cachePoint: { type: "default" } });
    expect(markers(messages)).toBe(1);
  });

  it("marks a plain last message", async () => {
    await llmCall(params(BEDROCK_CLAUDE, { cacheMessages: true }));
    expect(body().messages).toEqual([
      { role: "user", content: [{ text: "Hello" }, { cachePoint: { type: "default" } }] },
    ]);
  });

  it("marks the last message Converse receives, after empty ones are dropped", async () => {
    await llmCall(
      params(BEDROCK_CLAUDE, {
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "" },
        ],
        cacheMessages: true,
      })
    );
    expect(body().messages).toEqual([
      { role: "user", content: [{ text: "Hello" }, { cachePoint: { type: "default" } }] },
    ]);
  });

  it("keeps the system checkpoint, for two markers in all", async () => {
    await llmCall(
      params(BEDROCK_CLAUDE, { messages: loop, cacheMessages: true, systemPromptCacheBoundary: 6 })
    );
    const b = body();
    expect(b.system).toEqual([{ text: "System" }, { cachePoint: { type: "default" } }]);
    expect(markers(b)).toBe(2);
  });

  it.each(["bedrock:meta.llama3-8b-instruct-v1:0", "bedrock:amazon.nova-lite-v1:0"])(
    "sends no checkpoint to %s",
    async (model) => {
      await llmCall(params(model, { messages: loop, cacheMessages: true }));
      expect(markers(body())).toBe(0);
    }
  );

  it("sends the messages unmarked without cacheMessages", async () => {
    await llmCall(params(BEDROCK_CLAUDE, { messages: loop }));
    expect(markers(body())).toBe(0);
  });
});

describe("cacheMessages elsewhere", () => {
  it("is ignored by OpenAI-compatible providers, which cache on their own", async () => {
    await llmCall(params("openai:gpt-4o", { messages: loop, cacheMessages: true }));
    expect(markers(body())).toBe(0);
  });
});
