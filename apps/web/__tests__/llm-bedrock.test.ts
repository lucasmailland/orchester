// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmCall, llmStream, type LlmCallParams } from "@/lib/llm-call";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(),
  schema: { aiProviders: { workspaceId: "workspaceId", provider: "provider" } },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "test-key" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const claude = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
let endpoint: string | null = null;
const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ enabled: true, apiKey: "encrypted-test-key", endpoint }],
      }),
    }),
  }),
};
const params = (overrides: Partial<LlmCallParams> = {}): LlmCallParams => ({
  workspaceId: "test-workspace",
  model: `bedrock:${claude}`,
  systemPrompt: "Static. Dynamic.",
  messages: [{ role: "user", content: "Hello" }],
  tx: tx as unknown as NonNullable<LlmCallParams["tx"]>,
  ...overrides,
});
const response = {
  output: { message: { role: "assistant", content: [{ text: "Hello " }, { text: "world" }] } },
  usage: { inputTokens: 23, outputTokens: 7, totalTokens: 30 },
};
function request() {
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url, init, body: JSON.parse(init!.body as string) };
}
beforeEach(() => {
  endpoint = null;
  fetchMock.mockReset().mockResolvedValue(Response.json(response));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Bedrock Converse", () => {
  it.each([claude, "meta.llama3-8b-instruct-v1:0", "amazon.nova-lite-v1:0"])(
    "uses the vendor-neutral request for %s",
    async (model) => {
      const result = await llmCall(
        params({ model: `bedrock:${model}`, temperature: 0, maxTokens: 256 })
      );
      const { url, init, body } = request();
      expect(url).toBe(
        `https://bedrock-runtime.us-east-1.amazonaws.com/model/${encodeURIComponent(model)}/converse`
      );
      expect(init?.headers).toEqual({
        authorization: "Bearer test-key",
        "content-type": "application/json",
        accept: "application/json",
      });
      expect(body).toEqual({
        system: [{ text: "Static. Dynamic." }],
        messages: [{ role: "user", content: [{ text: "Hello" }] }],
        inferenceConfig: { maxTokens: 256, temperature: 0 },
      });
      expect(body).not.toHaveProperty("anthropic_version");
      expect(result).toMatchObject({ content: "Hello world", tokensUsed: 30, model });
    }
  );
  it.each([
    [" eu-west-1/ ", "https://bedrock-runtime.eu-west-1.amazonaws.com"],
    ["https://bedrock.example.com/", "https://bedrock.example.com"],
  ])("preserves endpoint resolution for %s", async (value, base) => {
    endpoint = value;
    await llmCall(params());
    expect(request().url).toBe(`${base}/model/${encodeURIComponent(claude)}/converse`);
  });
  it("preserves default inference settings", async () => {
    await llmCall(params());
    expect(request().body.inferenceConfig).toEqual({ maxTokens: 1024, temperature: 0.7 });
  });
  it("omits sampling for models marked noSampling", async () => {
    await llmCall(params({ model: "bedrock:us.anthropic.claude-opus-4-7", temperature: 0.2 }));
    expect(request().body.inferenceConfig).toEqual({ maxTokens: 1024 });
  });
  it("places a Claude checkpoint between the static prefix and dynamic suffix", async () => {
    await llmCall(params({ systemPromptCacheBoundary: 7 }));
    expect(request().body.system).toEqual([
      { text: "Static." },
      { cachePoint: { type: "default" } },
      { text: " Dynamic." },
    ]);
  });
  it.each([16, 100])("caches the whole prompt for boundary %s", async (boundary) => {
    await llmCall(params(boundary === undefined ? {} : { systemPromptCacheBoundary: boundary }));
    expect(request().body.system).toEqual([
      { text: "Static. Dynamic." },
      { cachePoint: { type: "default" } },
    ]);
  });
  it.each([undefined, 0, -1, 1.5, NaN])("ignores invalid/absent boundary %s", async (boundary) => {
    await llmCall(params(boundary === undefined ? {} : { systemPromptCacheBoundary: boundary }));
    expect(request().body.system).toEqual([{ text: "Static. Dynamic." }]);
  });
  it("omits an empty system prompt", async () => {
    await llmCall(params({ systemPrompt: "", systemPromptCacheBoundary: 7 }));
    expect(request().body).not.toHaveProperty("system");
  });
  it("does not send Claude cache markers to other vendors", async () => {
    await llmCall(
      params({ model: "bedrock:meta.llama3-8b-instruct-v1:0", systemPromptCacheBoundary: 7 })
    );
    expect(request().body.system).toEqual([{ text: "Static. Dynamic." }]);
  });
  it("maps input/output and cache usage", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        ...response,
        usage: {
          inputTokens: 23,
          outputTokens: 7,
          totalTokens: 30,
          cacheReadInputTokens: 2000,
          cacheWriteInputTokens: 1000,
        },
      })
    );
    expect(await llmCall(params())).toMatchObject({
      tokensUsed: 30,
      cacheUsage: {
        inputTokens: 23,
        outputTokens: 7,
        cacheReadTokens: 2000,
        cacheCreationTokens: 1000,
      },
    });
  });
  it("defaults missing usage to zero", async () => {
    fetchMock.mockResolvedValue(Response.json({ output: response.output }));
    expect(await llmCall(params())).toMatchObject({
      tokensUsed: 0,
      cacheUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    });
  });
  it("maps tool definitions, assistant calls, and tool results", async () => {
    const toolCall = { id: "tool-1", name: "lookup", input: { query: "test" } };
    const toolUse = { toolUseId: "tool-1", name: "lookup", input: { query: "test" } };
    fetchMock.mockResolvedValue(
      Response.json({
        ...response,
        output: { message: { content: [{ text: "Looking up" }, { toolUse }] } },
      })
    );
    const result = await llmCall(
      params({
        tools: [
          { name: "lookup", description: "Look up a value", inputSchema: { type: "object" } },
        ],
        messages: [
          { role: "system", content: "Ignored as before" },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Looking up", toolCalls: [toolCall] },
          {
            role: "tool",
            content: "",
            toolResults: [
              { id: "tool-1", name: "lookup", output: { value: 1 } },
              { id: "tool-2", name: "lookup", output: "found" },
              { id: "tool-3", name: "lookup", error: "Unavailable" },
            ],
          },
        ],
      })
    );
    expect(request().body.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: "lookup",
            description: "Look up a value",
            inputSchema: { json: { type: "object" } },
          },
        },
      ],
    });
    expect(request().body.messages).toEqual([
      { role: "user", content: [{ text: "Hello" }] },
      { role: "assistant", content: [{ text: "Looking up" }, { toolUse }] },
      {
        role: "user",
        content: [
          { toolResult: { toolUseId: "tool-1", content: [{ text: '{"value":1}' }] } },
          { toolResult: { toolUseId: "tool-2", content: [{ text: "found" }] } },
          {
            toolResult: {
              toolUseId: "tool-3",
              content: [{ text: "Error: Unavailable" }],
              status: "error",
            },
          },
        ],
      },
    ]);
    expect(result.toolCalls).toEqual([toolCall]);
  });
  it.each([
    ["us.amazon.nova-pro-v1:0", true],
    ["us.anthropic.claude-sonnet-5", true],
    ["us.meta.llama3-3-70b-instruct-v1:0", false],
    ["mistral.mistral-large-2407-v1:0", false],
    ["cohere.command-r-plus-v1:0", false],
  ])("marks a failed tool result on %s: %s", async (model, marked) => {
    // AWS supports `status` on a tool result for Nova and Claude only. Sending
    // it elsewhere is a ValidationException on the first failing tool call —
    // for exactly the models Converse was adopted to reach. The error text is
    // in the content either way.
    fetchMock.mockResolvedValue(Response.json(response));
    await llmCall(
      params({
        model: `bedrock:${model}`,
        messages: [
          { role: "user", content: "Hello" },
          {
            role: "tool",
            content: "",
            toolResults: [{ id: "tool-1", name: "lookup", error: "Unavailable" }],
          },
        ],
      })
    );
    const toolResult = request().body.messages.at(-1).content[0].toolResult;
    expect(toolResult.content).toEqual([{ text: "Error: Unavailable" }]);
    expect("status" in toolResult).toBe(marked);
  });
  it("drops a turn that carries no content at all", async () => {
    // Converse rejects a message with an empty content array, where the old
    // Anthropic-shaped body got away with sending content: "".
    fetchMock.mockResolvedValue(Response.json(response));
    await llmCall(
      params({
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "" },
          { role: "user", content: "Still there?" },
        ],
      })
    );
    expect(request().body.messages).toEqual([
      { role: "user", content: [{ text: "Hello" }] },
      { role: "user", content: [{ text: "Still there?" }] },
    ]);
  });
  it("surfaces the HTTP status and Bedrock error body", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "Model does not support tool use" }, { status: 400 })
    );
    await expect(llmCall(params())).rejects.toThrow(
      'Bedrock 400: {"message":"Model does not support tool use"}'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reintenta sin temperature cuando el modelo la rechaza", async () => {
    // Kimi K3 en Bedrock contesta 400 "This model doesn't support the
    // temperature field". El catálogo marca los conocidos con noSampling, pero
    // Bedrock suma modelos todas las semanas: el catálogo siempre va atrás.
    // Por eso el modelo de esta prueba NO está en el catálogo — es el caso que
    // importa: uno que salió ayer y nadie anotó todavía.
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { message: "This model doesn't support the temperature field. Remove temperature." },
          { status: 400 }
        )
      )
      .mockResolvedValue(Response.json(response));

    const result = await llmCall(params({ model: "bedrock:recien.salido-del-horno-v1:0" }));

    expect(result.content).toBe("Hello world");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primero = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const segundo = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(primero.inferenceConfig).toHaveProperty("temperature");
    expect(segundo.inferenceConfig).not.toHaveProperty("temperature");
  });
  it("no reintenta un 400 que no habla de sampling", async () => {
    // Reintentar a ciegas convierte un error claro en dos llamadas y el mismo
    // error, cobrando el doble.
    fetchMock.mockResolvedValue(
      Response.json({ message: "Model does not support tool use" }, { status: 400 })
    );
    await expect(llmCall(params())).rejects.toThrow("Bedrock 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps llmStream's blocking fallback working through Converse", async () => {
    const chunks = [];
    for await (const chunk of llmStream(params())) chunks.push(chunk);
    expect(request().url).toMatch(/\/converse$/);
    expect(chunks).toEqual([
      { type: "text", delta: "Hello world" },
      { type: "done", tokensUsed: 30, model: claude },
    ]);
  });
});
