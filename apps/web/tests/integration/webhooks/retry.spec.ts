// apps/web/tests/integration/webhooks/retry.spec.ts
//
// CONV-8 — manual webhook delivery retry + re-enable auto-disabled webhook.
// Seeds a disabled webhook with failureCount=20, calls retryDelivery, then
// asserts the webhook is re-enabled and a new delivery row was created.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let retryDelivery: typeof import("@/app/api/webhooks-out/[id]/deliveries/[deliveryId]/retry/route").retryDelivery;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ retryDelivery } =
    await import("@/app/api/webhooks-out/[id]/deliveries/[deliveryId]/retry/route"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

describe("webhook delivery retry", () => {
  it("re-delivers a failed delivery and re-enables a disabled webhook", async () => {
    const db = getDb();
    const whId = createId();
    await db.insert(schema.outboundWebhooks).values({
      id: whId,
      workspaceId: wsA.id,
      url: "https://example.com/hook",
      secret: "s3cr3t",
      events: ["agent.responded"],
      enabled: false,
      failureCount: 20,
    });
    const deliveryId = createId();
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: whId,
      workspaceId: wsA.id,
      event: "agent.responded",
      payload: { hello: "world" },
      status: "failed",
    });

    const out = await retryDelivery(wsA.id, whId, deliveryId);
    expect(out.ok).toBe(true);

    const wh = await db
      .select()
      .from(schema.outboundWebhooks)
      .where(eq(schema.outboundWebhooks.id, whId));
    expect(wh[0]!.enabled).toBe(true);

    const deliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, whId));
    expect(deliveries.length).toBeGreaterThanOrEqual(2);
  });
}, 30_000);
