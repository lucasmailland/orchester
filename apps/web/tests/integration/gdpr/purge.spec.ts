// SEC-014: export files are deleted once their 7-day link expires.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

const DAY = 24 * 60 * 60 * 1000;
let wsA: WsFixture;
let wsB: WsFixture;
let dir: string;
let purgeExpiredExports: typeof import("@/lib/gdpr/purge").purgeExpiredExports;
let regenerateSignedUrl: typeof import("@/lib/gdpr/storage").regenerateSignedUrl;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  dir = await mkdtemp(path.join(tmpdir(), "gdpr-purge-"));
  process.env["STORAGE_BACKEND"] = "filesystem";
  process.env["GDPR_EXPORT_DIR"] = dir;
  ({ purgeExpiredExports } = await import("@/lib/gdpr/purge"));
  ({ regenerateSignedUrl } = await import("@/lib/gdpr/storage"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await teardownTestWorkspaces();
});

async function seed(ws: WsFixture, ageDays: number, state: "completed" | "failed" = "completed") {
  const id = `exp_${createId()}`;
  const key = `${ws.id}/${id}.zip`;
  const at = new Date(Date.now() - ageDays * DAY);
  const file = path.join(dir, key.replace(/\//g, "_"));
  await writeFile(file, "zip");
  await getDb()
    .insert(schema.gdprExportJobs)
    .values({
      id,
      workspaceId: ws.id,
      requestedByUserId: ws.ownerId,
      state,
      storageKey: state === "completed" ? key : null,
      completedAt: state === "completed" ? at : null,
      createdAt: at,
    });
  return { id, file };
}

const exists = (f: string) =>
  access(f).then(
    () => true,
    () => false
  );
const getJob = async (id: string) =>
  (await getDb().select().from(schema.gdprExportJobs).where(eq(schema.gdprExportJobs.id, id)))[0];

describe("purgeExpiredExports", () => {
  it("deletes the file and nulls storage_key of a job completed 8 days ago", async () => {
    const j = await seed(wsA, 8);
    await purgeExpiredExports();
    expect(await exists(j.file)).toBe(false);
    expect((await getJob(j.id))?.storageKey).toBeNull();
  });

  it("keeps a job completed 6 days ago", async () => {
    const j = await seed(wsA, 6);
    await purgeExpiredExports();
    expect(await exists(j.file)).toBe(true);
    expect((await getJob(j.id))?.storageKey).not.toBeNull();
  });

  it("purges expired jobs of other workspaces too", async () => {
    const j = await seed(wsB, 9);
    await purgeExpiredExports();
    expect(await exists(j.file)).toBe(false);
    expect((await getJob(j.id))?.storageKey).toBeNull();
  });

  it("deletes failed jobs older than 30 days and their partial file", async () => {
    const old = await seed(wsA, 31, "failed");
    const recent = await seed(wsA, 5, "failed");
    await purgeExpiredExports();
    expect(await exists(old.file)).toBe(false);
    expect(await getJob(old.id)).toBeUndefined();
    expect(await getJob(recent.id)).toBeDefined();
  });

  it("is idempotent when the file is already gone", async () => {
    const j = await seed(wsA, 8);
    await rm(j.file);
    await expect(purgeExpiredExports()).resolves.toBeDefined();
    expect((await getJob(j.id))?.storageKey).toBeNull();
  });
});

describe("regenerateSignedUrl", () => {
  it("anchors expiry to completedAt, so an 8-day-old export is already expired", async () => {
    const completedAt = new Date(Date.now() - 8 * DAY);
    const r = await regenerateSignedUrl("w/j.zip", completedAt);
    expect(r.expiresAt.getTime()).toBe(completedAt.getTime() + 7 * DAY);
    expect(r.expiresAt.getTime()).toBeLessThan(Date.now());
  });
});

describe("polling route for expired exports", () => {
  it("responds 410 for a purged job", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth-guards", () => ({
      requireAuth: async () => ({ user: { id: wsA.ownerId } }),
    }));
    const j = await seed(wsA, 8);
    await purgeExpiredExports();
    const { GET } = await import("@/app/api/workspaces/[slug]/export/[jobId]/route");
    const res = await GET({} as never, {
      params: Promise.resolve({ slug: wsA.slug, jobId: j.id }),
    });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Export expired" });
  });

  it("responds 410 for an expired job not yet purged (R2)", async () => {
    const j = await seed(wsA, 8);
    const { GET } = await import("@/app/api/workspaces/[slug]/export/[jobId]/route");
    const res = await GET({} as never, {
      params: Promise.resolve({ slug: wsA.slug, jobId: j.id }),
    });
    expect(res.status).toBe(410);
  });
});
