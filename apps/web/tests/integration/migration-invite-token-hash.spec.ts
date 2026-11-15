import { it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../fixtures/workspaces";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let sqlTag: typeof import("drizzle-orm").sql;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
  ({ sql: sqlTag, eq } = await import("drizzle-orm"));
}, 60_000);
afterAll(() => teardownTestWorkspaces());

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

it("0068 hashes plaintext invite tokens the way the app looks them up, once", async () => {
  const db = getDb();
  const plain = crypto.randomBytes(24).toString("base64url");
  const alreadyHashed = sha256("inv_new");
  const invite = (id: string, token: string) => ({
    id,
    workspaceId: wsA.id,
    email: `${id}@example.com`,
    token,
    invitedByUserId: wsA.ownerId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await db
    .insert(schema.workspaceInvites)
    .values([invite("inv_old", plain), invite("inv_hashed", alreadyHashed)]);

  const file = path.resolve(
    __dirname,
    "../../../../packages/db/migrations/0068_workspace_invite_token_hash.sql"
  );
  const body = fs.readFileSync(file, "utf8");
  await db.execute(sqlTag.raw(body));
  await db.execute(sqlTag.raw(body)); // re-running must not hash twice

  const token = async (id: string) =>
    (await db.select().from(schema.workspaceInvites).where(eq(schema.workspaceInvites.id, id)))[0]!
      .token;
  expect(await token("inv_old")).toBe(sha256(plain));
  expect(await token("inv_hashed")).toBe(alreadyHashed);
});
