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

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(teardownTestWorkspaces);

it("updateChannelConfig merges branding fields into channel.config", async () => {
  const db = getDb();
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    name: "w",
    type: "widget",
    status: "active",
    config: { color: "#000" },
  } as never);

  const { updateChannelConfig } = await import("@/lib/channels/config-store");
  await updateChannelConfig(wsA.id, channelId, {
    greeting: "Hi there",
    title: "Support",
    placeholder: "Type…",
    starters: ["Pricing?"],
  });

  const row = (
    await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1)
  )[0]!;
  const cfg = row.config as Record<string, unknown>;
  expect(cfg).toMatchObject({
    color: "#000",
    greeting: "Hi there",
    title: "Support",
    placeholder: "Type…",
  });
  expect(cfg.starters).toEqual(["Pricing?"]);
});
