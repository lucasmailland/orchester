import { it, expect, vi, afterEach, beforeAll } from "vitest";

// The web_search fetch path now runs through the DNS-resolving SSRF guard
// (assertPublicUrlResolved). The test endpoints (search.example) don't exist,
// so stub the DNS lookup to a public IP so the guard passes and the real
// assertion (fetch normalization) runs. `@/lib/tools` is imported dynamically
// (below) so this mock is registered before net-guard binds its `lookup`.
const publicIp = [{ address: "93.184.216.34", family: 4 }];
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => publicIp),
  default: { lookup: vi.fn(async () => publicIp) },
}));

let executeTool: typeof import("@/lib/tools").executeTool;
let getToolDefinitions: typeof import("@/lib/tools").getToolDefinitions;
beforeAll(async () => {
  ({ executeTool, getToolDefinitions } = await import("@/lib/tools"));
});

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
