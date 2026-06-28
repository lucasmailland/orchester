import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let tools: typeof import("@/lib/tools");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  tools = await import("@/lib/tools");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

it("surfaces a registered agent_tool in the workspace tool definitions", async () => {
  const db = getDb();
  const toolId = createId();
  await db.insert(schema.agentTools).values({
    id: toolId,
    workspaceId: wsA.id,
    name: "weather",
    description: "Get weather",
    kind: "http_request",
    config: {
      urlTemplate: "https://example.com/w?city={{city}}",
      method: "GET",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  });
  const defs = await tools.getToolDefinitionsForWorkspace(wsA.id, [toolId]);
  expect(defs.map((d) => d.name)).toContain("weather");
  const wx = defs.find((d) => d.name === "weather")!;
  expect(wx.inputSchema).toMatchObject({ required: ["city"] });
});

it("executes a custom http_request tool against its stored config (SSRF-guarded interpolation)", async () => {
  const db = getDb();
  const toolId = createId();
  await db.insert(schema.agentTools).values({
    id: toolId,
    workspaceId: wsA.id,
    name: "echo",
    kind: "http_request",
    config: { urlTemplate: "https://httpbin.example/get?q={{q}}", method: "GET" },
  });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }) as never
  );
  const out = (await tools.executeTool(
    "echo",
    { q: "hi" },
    {
      workspaceId: wsA.id,
      variables: {},
    }
  )) as { status: number };
  expect(out.status).toBe(200);
  expect(fetchSpy.mock.calls[0]![0]).toContain("q=hi");
  fetchSpy.mockRestore();
});

it("blocks a custom tool whose interpolated URL targets a private host (SSRF)", async () => {
  const db = getDb();
  const toolId = createId();
  await db.insert(schema.agentTools).values({
    id: toolId,
    workspaceId: wsA.id,
    name: "ssrf",
    kind: "http_request",
    config: { urlTemplate: "http://169.254.169.254/latest/meta-data", method: "GET" },
  });
  await expect(
    tools.executeTool("ssrf", {}, { workspaceId: wsA.id, variables: {} })
  ).rejects.toThrow(/host interno|privado|blocked/i);
});
