import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let exchangeOAuthCode: typeof import("@/lib/integrations/oauth").exchangeOAuthCode;

beforeAll(async () => {
  process.env.ENCRYPTION_SECRET ??= "0".repeat(64);
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
  ({ exchangeOAuthCode } = await import("@/lib/integrations/oauth"));
}, 60_000);
afterAll(teardownTestWorkspaces);

it("exchanging the code stores encrypted tokens and marks the integration connected", async () => {
  const db = getDb();
  const intId = createId();
  await db.insert(schema.workspaceIntegrations).values({
    id: intId,
    workspaceId: wsA.id,
    type: "google",
    name: "G",
    configEncrypted: JSON.stringify({ clientId: "c", clientSecret: "s" }),
    status: "error",
    enabled: true,
  } as never);

  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }) as never
  );

  await exchangeOAuthCode({
    workspaceId: wsA.id,
    integrationId: intId,
    provider: "google",
    code: "abc",
    redirectUri: "https://app/cb",
  });

  const row = (
    await db
      .select()
      .from(schema.workspaceIntegrations)
      .where(eq(schema.workspaceIntegrations.id, intId))
      .limit(1)
  )[0]!;
  expect(row.status).toBe("connected");
  expect(row.lastTestedAt).toBeTruthy();
});
