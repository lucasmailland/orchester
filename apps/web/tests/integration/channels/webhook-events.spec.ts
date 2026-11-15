// apps/web/tests/integration/channels/webhook-events.spec.ts
//
// CONV-1 — verifies the router emits conversation.created + message.received
// when a new inbound conversation is created. We register a subscriber for
// those events and assert a webhook_delivery row lands (delivery itself
// fails to a blocked host — we only care that dispatchEvent ran).
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
let handleInbound: typeof import("@/lib/channels/router").handleInbound;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ handleInbound } = await import("@/lib/channels/router"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

describe("webhook event dispatch", () => {
  it("emits conversation.created + message.received on new inbound", async () => {
    const db = getDb();
    const agentId = wsA.agentIds[0]!;
    const channelId = createId();
    await db.insert(schema.channels).values({
      id: channelId,
      workspaceId: wsA.id,
      agentId,
      name: "wh-ev-channel",
      type: "web",
      status: "active",
    });
    // Subscriber for the two creation events. URL is example.com — delivery
    // fails (no real server) but the delivery ROW is what proves dispatch.
    const webhookId = createId();
    await db.insert(schema.outboundWebhooks).values({
      id: webhookId,
      workspaceId: wsA.id,
      url: "https://example.com/hook",
      secret: "s3cr3t",
      events: ["conversation.created", "message.received"],
      enabled: true,
    });

    // LLM has no provider → throws after the user message insert; the
    // creation events fire inside resolveInbound BEFORE that throw.
    await expect(
      handleInbound(wsA.id, { channelId, externalId: `ext-${createId()}`, text: "hi" })
    ).rejects.toThrow();

    // dispatchEvent is fire-and-forget — give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 200));

    const deliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.workspaceId, wsA.id));
    const events = deliveries.map((d) => d.event).sort();
    expect(events).toContain("conversation.created");
    expect(events).toContain("message.received");
  });
});
