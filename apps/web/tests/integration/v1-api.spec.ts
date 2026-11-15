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
let apiKey: string;
let agentsRoute: typeof import("@/app/api/v1/agents/route");
let openapiRoute: typeof import("@/app/api/v1/openapi.json/route");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  process.env.ENCRYPTION_SECRET ??= "0".repeat(64);
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));

  // Mint an API key directly via DB insert
  const { generateApiKey } = await import("@/lib/api-auth/key");
  const key = generateApiKey();
  apiKey = key.plain;
  const db = getDb();
  await db.insert(schema.apiKeys).values({
    id: createId(),
    workspaceId: wsA.id,
    name: "test",
    hashedKey: key.hashed,
    prefix: key.prefix,
    scopes: ["agents:read", "agents:write", "flows:read", "flows:write"],
  } as never);

  agentsRoute = await import("@/app/api/v1/agents/route");
  openapiRoute = await import("@/app/api/v1/openapi.json/route");
}, 60_000);
afterAll(teardownTestWorkspaces);

function req(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
}

it("GET /v1/agents paginates (limit + nextCursor)", async () => {
  const res = await agentsRoute.GET(req("https://app/api/v1/agents?limit=2"));
  const j = (await res.json()) as { data: unknown[]; nextCursor: unknown };
  expect(res.status).toBe(200);
  expect(Array.isArray(j.data)).toBe(true);
  expect(j.data.length).toBeLessThanOrEqual(2);
  expect(j).toHaveProperty("nextCursor");
});

it("POST /v1/agents creates an agent scoped to the key's workspace", async () => {
  const res = await agentsRoute.POST(
    req("https://app/api/v1/agents", {
      method: "POST",
      body: JSON.stringify({ name: "API Bot", role: "support", systemPrompt: "be helpful" }),
    })
  );
  const j = (await res.json()) as { data: { id: string } };
  expect(res.status).toBe(201);
  expect(j.data.id).toBeTruthy();
});

it("serves an OpenAPI 3.1 document describing the v1 routes", async () => {
  const res = await openapiRoute.GET();
  const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
  expect(doc.openapi).toMatch(/^3\.1/);
  expect((doc.paths["/v1/agents"] as { get: unknown } | undefined)?.get).toBeTruthy();
  expect((doc.paths["/v1/agents"] as { post: unknown } | undefined)?.post).toBeTruthy();
});
