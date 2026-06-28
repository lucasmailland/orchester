import { it, expect, vi, beforeAll, afterAll } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let wsA: WsFixture;
let route: typeof import("@/app/api/embed/route");
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  route = await import("@/app/api/embed/route");
  ({ getDb, schema } = await import("@orchester/db"));
}, 60_000);
afterAll(teardownTestWorkspaces);

it("emits a script whose iframe src carries the locale + position params", async () => {
  const db = getDb();
  const channelId = createId();
  await db.insert(schema.channels).values({
    id: channelId,
    workspaceId: wsA.id,
    name: "w",
    type: "widget",
    status: "active",
    config: {},
  } as never);

  const res = await route.GET(
    new Request(`https://app/api/embed?c=${channelId}&locale=en&position=left`)
  );
  const js = await res.text();
  expect(js).toContain(`/widget/${channelId}`);
  expect(js).toMatch(/locale=en/);
  expect(js).toMatch(/left/);
});
