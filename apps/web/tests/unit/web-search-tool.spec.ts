import { it, expect, vi, afterEach } from "vitest";
import { executeTool, getToolDefinitions } from "@/lib/tools";

const OLD = process.env.WEB_SEARCH_ENDPOINT;
const OLD_KEY = process.env.WEB_SEARCH_API_KEY;
afterEach(() => {
  process.env.WEB_SEARCH_ENDPOINT = OLD;
  process.env.WEB_SEARCH_API_KEY = OLD_KEY;
  vi.restoreAllMocks();
});

it("web_search is registered with a query param", () => {
  const defs = getToolDefinitions(["web_search"]);
  expect(defs).toHaveLength(1);
  expect(defs[0]!.inputSchema).toMatchObject({ required: ["query"] });
});

it("throws a configure error when no provider is set", async () => {
  delete process.env.WEB_SEARCH_ENDPOINT;
  delete process.env.WEB_SEARCH_API_KEY;
  await expect(
    executeTool("web_search", { query: "orchester ai" }, { workspaceId: "ws", variables: {} })
  ).rejects.toThrow(/web search.*not configured|configurá/i);
});

it("returns normalized results from the configured provider", async () => {
  process.env.WEB_SEARCH_ENDPOINT = "https://search.example/api";
  process.env.WEB_SEARCH_API_KEY = "k";
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        web: {
          results: [{ title: "T", url: "https://x", description: "S" }],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ) as never
  );
  const out = (await executeTool(
    "web_search",
    { query: "x" },
    {
      workspaceId: "ws",
      variables: {},
    }
  )) as { results: Array<{ title: string; url: string; snippet: string }> };
  expect(out.results[0]).toEqual({ title: "T", url: "https://x", snippet: "S" });
});
