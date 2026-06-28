import { it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/encryption", () => ({ decrypt: (s: string) => s }));
vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => [{ apiKey: "k", enabled: true }] }),
      }),
    }),
  }),
  schema: { aiProviders: { workspaceId: "w", provider: "p" } },
}));

afterEach(() => vi.restoreAllMocks());

it("requests OpenAI large embeddings with dimensions:1536 and stores at length 1536", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [{ embedding: new Array(1536).fill(0.01) }],
        usage: { total_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ) as never
  );
  const { embed } = await import("@/lib/embeddings");
  const res = await embed("ws", "openai", "text-embedding-3-large", ["hi"]);
  expect(res.vectors[0]).toHaveLength(1536);
  const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
  expect(body.dimensions).toBe(1536);
  expect(res.dims).toBe(1536);
  expect(res.model).toBe("text-embedding-3-large");
});
