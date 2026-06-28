import { it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/encryption", () => ({ decrypt: (s: string) => s }));
const mockTx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => [{ apiKey: "k", enabled: true, endpoint: "https://azure.example" }],
      }),
    }),
  }),
};
vi.mock("@orchester/db", () => ({
  getDb: () => mockTx,
  schema: { aiProviders: {} },
}));
vi.mock("@/lib/tenant/context", () => ({
  withWorkspaceTx: (_ws: string, fn: (tx: unknown) => unknown) => fn(mockTx),
}));

const toolDefs = [
  {
    name: "get_weather",
    description: "Weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
];

afterEach(() => vi.restoreAllMocks());

it("Gemini: a tool-enabled call sends functionDeclarations and surfaces a functionCall as a toolCall", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "get_weather", args: { city: "BA" } } }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ) as never
  );
  const { llmCall } = await import("@/lib/llm-call");
  const res = await llmCall({
    workspaceId: "ws",
    model: "gemini-2.5-flash",
    systemPrompt: "s",
    messages: [{ role: "user", content: "weather?" }],
    tools: toolDefs,
  });
  const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
  expect(body.tools[0].functionDeclarations[0].name).toBe("get_weather");
  expect(res.toolCalls?.[0]).toMatchObject({ name: "get_weather", input: { city: "BA" } });
});

it("Azure: a tool-enabled call sends tools and surfaces tool_calls", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", function: { name: "get_weather", arguments: '{"city":"BA"}' } },
              ],
            },
          },
        ],
        usage: { total_tokens: 7 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ) as never
  );
  const { llmCall } = await import("@/lib/llm-call");
  const res = await llmCall({
    workspaceId: "ws",
    model: "azure/gpt-4o",
    systemPrompt: "s",
    messages: [{ role: "user", content: "weather?" }],
    tools: toolDefs,
  });
  const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
  expect(body.tools[0].function.name).toBe("get_weather");
  expect(res.toolCalls?.[0]).toMatchObject({ name: "get_weather", input: { city: "BA" } });
});
