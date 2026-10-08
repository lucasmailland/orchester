// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logWithContext } from "@/lib/observability";
import { llmCall, llmStream, type LlmCallParams } from "@/lib/llm-call";
vi.mock("@orchester/db", () => ({ getDb: vi.fn(), schema: { aiProviders: {} } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "test-key" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const image = {
  mediaType: "image/png",
  base64: Buffer.from("test-image-evidence").toString("base64"),
  name: "screen.png",
};
const tx = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => [{ enabled: true, apiKey: "test-key", endpoint: null }] }),
    }),
  }),
};
const params = (
  model: string,
  output: unknown = { text: "evidence", images: [image] }
): LlmCallParams => ({
  workspaceId: "test-workspace",
  model,
  systemPrompt: "test",
  tx: tx as unknown as NonNullable<LlmCallParams["tx"]>,
  messages: [
    { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "screens", input: {} }] },
    { role: "tool", content: "", toolResults: [{ id: "t1", name: "screens", output }] },
  ],
});
const body = () => JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(
    Response.json({
      content: [],
      output: { message: { content: [] } },
      choices: [{ message: { content: "ok" } }],
      usage: {},
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
describe("tool result images on the wire", () => {
  it.each([false, true])("maps Anthropic image blocks (stream=%s)", async (stream) => {
    if (stream) {
      fetchMock.mockResolvedValue(new Response('data: {"type":"message_stop"}\n\n'));
      for await (const _ of llmStream(params("anthropic:claude-haiku-4-5"))) {
        /* drain */
      }
    } else await llmCall(params("anthropic:claude-haiku-4-5"));
    expect(body().messages[1].content[0].content).toEqual([
      { type: "text", text: "evidence" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: image.base64 } },
    ]);
  });
  it("maps Bedrock JSON bytes as base64", async () => {
    await llmCall(params("bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0"));
    expect(body().messages[1].content[0].toolResult.content).toEqual([
      { text: "evidence" },
      { image: { format: "png", source: { bytes: image.base64 } } },
    ]);
  });
  it("adds one labelled OpenAI user message after all tool replies", async () => {
    const p = params("openai:gpt-4o");
    p.messages[1]!.toolResults!.push({
      id: "t2",
      name: "more_screens",
      output: { text: "more", images: [image] },
    });
    await llmCall(p);
    expect(
      body()
        .messages.slice(2)
        .map((m: { role: string }) => m.role)
    ).toEqual(["tool", "tool", "user"]);
    expect(body().messages[2].content).toBe("evidence");
    expect(body().messages[4].content).toEqual([
      { type: "text", text: "Tool output: screens (t1)" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.base64}` } },
      { type: "text", text: "Tool output: more_screens (t2)" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.base64}` } },
    ]);
  });
  it.each(["openai:unknown-model", "bedrock:amazon.nova-micro-v1:0", "anthropic:unknown-model"])(
    "gates non-vision model %s",
    async (model) => {
      await llmCall(params(model));
      expect(JSON.stringify(body())).not.toContain(image.base64);
      expect(JSON.stringify(body())).toContain(
        "1 images omitted: model/provider does not accept images"
      );
    }
  );
  it("drops the fifth, oversized and unsupported images with their names", async () => {
    await llmCall(
      params("openai:gpt-4o", {
        text: "evidence",
        images: [
          { ...image, name: "large.png", base64: Buffer.alloc(1024 * 1024 + 1).toString("base64") },
          { ...image, name: "bad.svg", mediaType: "image/svg+xml" },
          ...Array.from({ length: 5 }, (_, i) => ({ ...image, name: `${i + 1}.png` })),
        ],
      })
    );
    const text = body().messages[2].content;
    expect(text).toContain("large.png");
    expect(text).toContain("bad.svg");
    expect(text).toContain("5.png");
    expect(
      body().messages[3].content.filter((b: { type: string }) => b.type === "image_url")
    ).toHaveLength(4);
    expect(JSON.stringify(body()).length).toBeLessThan(2000);
  });
});

it.each(["google:gemini-2.5-flash", "azure_openai:test-deployment"])(
  "retains text plus omission note on unsupported adapter %s",
  async (model) => {
    const p = params(model);
    p.tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { enabled: true, apiKey: "test-key", endpoint: "https://example.com" },
            ],
          }),
        }),
      }),
    } as unknown as NonNullable<LlmCallParams["tx"]>;
    await llmCall(p);
    expect(JSON.stringify(body())).toContain("evidence");
    expect(JSON.stringify(body())).toContain(
      "1 images omitted: model/provider does not accept images"
    );
    expect(JSON.stringify(body())).not.toContain(image.base64);
  }
);
it.each([
  "anthropic:claude-haiku-4-5",
  "openai:gpt-4o",
  "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0",
])("does not log or propagate image bytes echoed in %s errors", async (model) => {
  vi.mocked(logWithContext).mockClear();
  fetchMock.mockResolvedValue(new Response(`Invalid image: ${image.base64}`, { status: 400 }));
  const error = await llmCall(params(model)).catch((e) => e as Error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain(image.base64);
  expect(JSON.stringify(vi.mocked(logWithContext).mock.calls)).not.toContain(image.base64);
});
it.each(["anthropic:claude-haiku-4-5", "openai:gpt-4o"])(
  "does not emit image bytes echoed in streaming %s errors",
  async (model) => {
    fetchMock.mockResolvedValue(new Response(`Invalid image: ${image.base64}`, { status: 400 }));
    const chunks = [];
    for await (const chunk of llmStream(params(model))) chunks.push(chunk);
    expect(chunks.some((c) => c.type === "error")).toBe(true);
    expect(JSON.stringify(chunks)).not.toContain(image.base64);
  }
);
it.each(["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0"])(
  "enables catalogued Bedrock vision model %s",
  async (model) => {
    await llmCall(params(`bedrock:${model}`));
    expect(body().messages[1].content[0].toolResult.content[1]).toEqual({
      image: { format: "png", source: { bytes: image.base64 } },
    });
  }
);
it("preserves an empty plain Bedrock tool output", async () => {
  await llmCall(params("bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0", ""));
  expect(body().messages[1].content[0].toolResult.content).toEqual([{ text: "" }]);
});
