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
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(teardownTestWorkspaces);

it("searchConversations is case-insensitive (ILIKE) over customerName", async () => {
  const db = getDb();
  await db.insert(schema.conversations).values({
    id: createId(),
    workspaceId: wsA.id,
    customerName: "Verónica Gómez",
    status: "open",
  } as never);

  const { searchConversations } = await import("@/lib/conversations/query");
  const lower = await searchConversations(wsA.id, { search: "verónica" });
  const upper = await searchConversations(wsA.id, { search: "VERÓNICA" });
  expect(lower.length).toBeGreaterThanOrEqual(1);
  expect(upper.length).toBeGreaterThanOrEqual(1);
});
