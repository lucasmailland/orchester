import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
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

function mcpResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }) as never;
}

it("surfaces a connected MCP server's tools namespaced, and proxies a call", async () => {
  const db = getDb();
  const serverId = createId();
  await db.insert(schema.mcpServers).values({
    id: serverId,
    workspaceId: wsA.id,
    name: "github",
    transport: "http",
    url: "https://mcp.example/github",
    authHeaderEncrypted: null,
    enabled: true,
  });

  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    // initialize (called by listRemoteTools inside getToolDefinitionsForWorkspace)
    .mockResolvedValueOnce(mcpResponse({}))
    // tools/list
    .mockResolvedValueOnce(
      mcpResponse({
        tools: [
          {
            name: "create_issue",
            description: "Create an issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
            },
          },
        ],
      })
    )
    // tools/call (callRemoteTool skips initialize)
    .mockResolvedValueOnce(
      mcpResponse({
        content: [{ type: "text", text: "issue#42" }],
        structuredContent: { id: 42 },
      })
    );

  const toolName = `mcp__${serverId}__create_issue`;
  const defs = await tools.getToolDefinitionsForWorkspace(wsA.id, [toolName]);
  expect(defs.map((d) => d.name)).toContain(toolName);

  const out = (await tools.executeTool(
    toolName,
    { title: "Bug" },
    {
      workspaceId: wsA.id,
      variables: {},
    }
  )) as { structuredContent: { id: number } };
  expect(out.structuredContent.id).toBe(42);

  const callBody = JSON.parse((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body as string);
  expect(callBody.method).toBe("tools/call");
  expect(callBody.params.name).toBe("create_issue");
});
