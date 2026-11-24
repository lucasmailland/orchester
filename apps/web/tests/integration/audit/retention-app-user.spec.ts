// SEC-009: retention runs as app_user in production, and app_user has no
// DELETE on audit_log (0007). The trim goes through audit_log_trim (0073), and
// each retention block runs in its own savepoint so one failure does not void
// the others.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
process.env.ENCRYPTION_SECRET ??= "0123456789abcdef".repeat(4);

import { createId } from "@paralleldrive/cuid2";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let sqlTag: typeof import("drizzle-orm").sql;
let eq: typeof import("drizzle-orm").eq;

const DAY = 86_400_000;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ getDb, schema } = await import("@orchester/db"));
  ({ sql: sqlTag, eq } = await import("drizzle-orm"));
}, 90_000);
afterAll(() => teardownTestWorkspaces());

async function appendAt(n: number, daysAgo: number) {
  const { appendAuditSync } = await import("@/lib/audit/log");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() - daysAgo * DAY));
  try {
    for (let i = 0; i < n; i++)
      await appendAuditSync(wsA.id, {
        action: "workspace.update",
        actorUserId: wsA.ownerId,
        actorKind: "user",
        targetType: "workspace",
        targetId: wsA.id,
        meta: { i },
      });
  } finally {
    vi.useRealTimers();
  }
}

/** The driver's message: drizzle wraps it as `Failed query: ...` with a cause. */
const pgError = (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: { message?: string; cause?: { message?: string } }) => e.cause?.message ?? e.message ?? ""
  );

/** The production call (worker/index.ts), with the connection's role dropped to app_user. */
async function purgeAsAppUser() {
  const { withCrossTenantAdmin } = await import("@/lib/tenant/cron");
  const { purgeOldData } = await import("@/lib/retention");
  return withCrossTenantAdmin("test", async (tx) => {
    await tx.execute(sqlTag`SET LOCAL ROLE app_user`);
    return purgeOldData({ db: tx, auditLogsDays: 365, usageEventsDays: 90 });
  });
}

describe("retention as app_user", () => {
  it("app_user still cannot delete audit_log directly", async () => {
    const msg = await pgError(
      getDb().transaction(async (tx) => {
        await tx.execute(sqlTag`SET LOCAL ROLE app_user`);
        await tx.execute(sqlTag`DELETE FROM audit_log`);
      })
    );
    expect(msg).toMatch(/permission denied/);
  });

  it("trims old audit rows, writes the marker and purges the other blocks", async () => {
    await appendAt(2, 400);
    await appendAt(1, 0);
    const oldUsage = createId();
    await getDb()
      .insert(schema.usageEvents)
      .values({
        id: oldUsage,
        workspaceId: wsA.id,
        kind: "agent_message",
        createdAt: new Date(Date.now() - 200 * DAY),
      });

    const result = await purgeAsAppUser();

    expect(result.auditLogsDeleted).toBe(2);
    expect(result.usageEventsDeleted).toBe(1);
    const audit = await getDb()
      .select({ seq: schema.auditLog.seq, action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.workspaceId, wsA.id))
      .orderBy(schema.auditLog.seq);
    expect(audit.map((r) => [Number(r.seq), r.action])).toEqual([
      [3, "workspace.update"],
      [4, "audit.retention_trimmed"],
    ]);
    const usage = await getDb()
      .select()
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.id, oldUsage));
    expect(usage).toHaveLength(0);
    const { verifyChain } = await import("@/lib/audit/verify");
    expect((await verifyChain(wsA.id)).brokenAt).toBeNull();
  });

  it("audit_log_trim refuses a cutoff inside the last 30 days", async () => {
    const msg = await pgError(
      getDb().transaction(async (tx) => {
        await tx.execute(sqlTag`SET LOCAL ROLE app_user`);
        await tx.execute(sqlTag`SELECT * FROM audit_log_trim(now())`);
      })
    );
    expect(msg).toMatch(/30 days/);
  });
});
