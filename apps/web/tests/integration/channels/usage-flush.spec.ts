// apps/web/tests/integration/channels/usage-flush.spec.ts
//
// COST-5 — a partial/aborted stream must still record usage. We exercise
// the flush path directly: given a conversation + accumulated tokens, a
// usage_event with cost_usd > 0 and an assistant message must be persisted.
import { expect, beforeAll, afterAll, vi, it } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let flushPartialTurn: typeof import("@/lib/channels/router").flushPartialTurn;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ flushPartialTurn } = await import("@/lib/channels/router"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

it("records a usage_event with cost_usd > 0 for an aborted partial stream", async () => {
  const db = getDb();
  const agentId = wsA.agentIds[0]!;
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    agentId,
    name: "flush-channel",
    type: "web",
    status: "active",
  });
  const convId = createId();
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    channelId,
    agentId,
    status: "open",
    externalId: `ext-${createId()}`,
  });

  await flushPartialTurn(wsA.id, agentId, convId, "respuesta parcial…", 1234);

  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBeGreaterThanOrEqual(1);
  expect(Number(usage[0]!.costUsd)).toBeGreaterThan(0);

  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, convId));
  const partial = msgs.find((m) => m.content === "respuesta parcial…");
  expect(partial).toBeTruthy();
  expect(partial!.tokensUsed).toBe(1234);
});

it("is a no-op when tokens == 0 (nothing consumed)", async () => {
  const db = getDb();
  const agentId = wsA.agentIds[1]!;
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    agentId,
    name: "flush-noop",
    type: "web",
    status: "active",
  });
  const convId = createId();
  await db.insert(schema.conversations).values({
    id: convId,
    workspaceId: wsA.id,
    channelId,
    agentId,
    status: "open",
    externalId: `ext-${createId()}`,
  });
  await flushPartialTurn(wsA.id, agentId, convId, "", 0);
  const usage = await db
    .select()
    .from(schema.usageEvents)
    .where(
      and(eq(schema.usageEvents.workspaceId, wsA.id), eq(schema.usageEvents.agentId, agentId))
    );
  expect(usage.length).toBe(0);
});
