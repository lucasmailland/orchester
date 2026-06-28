import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let sqlTag: typeof import("drizzle-orm").sql;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb } = await import("@orchester/db"));
  ({ sql: sqlTag } = await import("drizzle-orm"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

async function indexExists(name: string): Promise<boolean> {
  const db = getDb();
  const runRaw = db["execute"].bind(db) as (q: unknown) => Promise<unknown>;
  const res = (await runRaw(sqlTag`SELECT 1 FROM pg_indexes WHERE indexname = ${name}`)) as
    | { rows?: unknown[] }
    | unknown[];
  const arr = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
  return arr.length > 0;
}

describe("0015 token-aggregation indexes (PERF-10)", () => {
  it("creates the covering token index on message", async () => {
    expect(await indexExists("idx_message_conv_created_tokens")).toBe(true);
  });
  it("creates the GIN index on conversation.tags", async () => {
    expect(await indexExists("idx_conversation_tags_gin")).toBe(true);
  });
});
