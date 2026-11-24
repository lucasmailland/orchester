// apps/web/tests/integration/audit/verify.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.4
// Plan: Task A.19
//
// End-to-end check that verifyChain accepts an intact chain and flags
// retroactive mutations of `meta`. Uses the testcontainer fixtures so
// we get a real postgres + the production hash code under test.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Un-mock @orchester/db (default vitest.setup stubs it out for unit
// tests). Dynamic-import the modules below so the real client is loaded
// AFTER fixtures set DATABASE_URL.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// v2 rows are keyed from ENCRYPTION_SECRET (CI sets one; local runs may not).
process.env.ENCRYPTION_SECRET ??= "0123456789abcdef".repeat(4);

import { createId } from "@paralleldrive/cuid2";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  insertAdHocWorkspace,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let appendAuditSync: typeof import("@/lib/audit/log").appendAuditSync;
let verifyChain: typeof import("@/lib/audit/verify").verifyChain;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;
let asc: typeof import("drizzle-orm").asc;
let lt: typeof import("drizzle-orm").lt;
let chain: typeof import("@/lib/audit/chain");

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ appendAuditSync } = await import("@/lib/audit/log"));
  ({ verifyChain } = await import("@/lib/audit/verify"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq, and, asc, lt } = await import("drizzle-orm"));
  chain = await import("@/lib/audit/chain");

  for (let i = 0; i < 5; i++) {
    await appendAuditSync(wsA.id, {
      action: "workspace.update",
      actorUserId: wsA.ownerId,
      actorKind: "user",
      targetType: "workspace",
      targetId: wsA.id,
      meta: { i },
    });
  }
});
afterAll(() => teardownTestWorkspaces());

describe("verifyChain", () => {
  it("returns brokenAt=null for an intact chain", async () => {
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).toBeNull();
    expect(r.entriesChecked).toBe(5);
  });

  it("detects tampering when meta is modified", async () => {
    const db = getDb();
    await db
      .update(schema.auditLog)
      .set({ meta: { tampered: true } })
      .where(eq(schema.auditLog.workspaceId, wsA.id));
    const r = await verifyChain(wsA.id);
    expect(r.brokenAt).not.toBeNull();
  });
});

const DAY = 24 * 60 * 60 * 1000;

// ── SEC-009: HMAC chain, mixed versions, trimmed chains, anchor ───────────

async function newWs(): Promise<{ wsId: string; ownerId: string }> {
  const wsId = createId();
  const ownerId = createId();
  await insertAdHocWorkspace(getDb(), { wsId, ownerId, slug: `v-${wsId.slice(0, 10)}` });
  return { wsId, ownerId };
}

async function append(wsId: string, ownerId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await appendAuditSync(wsId, {
      action: "workspace.update",
      actorUserId: ownerId,
      actorKind: "user",
      actorIp: "10.0.0.1",
      actorUserAgent: "test-agent",
      targetType: "workspace",
      targetId: wsId,
      meta: { i },
    });
  }
}

async function rows(wsId: string) {
  return getDb()
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.workspaceId, wsId))
    .orderBy(asc(schema.auditLog.seq));
}

async function setRow(wsId: string, seq: bigint, values: Record<string, unknown>) {
  await getDb()
    .update(schema.auditLog)
    .set(values)
    .where(and(eq(schema.auditLog.workspaceId, wsId), eq(schema.auditLog.seq, seq)));
}

describe("verifyChain — v2 HMAC rows", () => {
  it("writes new rows as hash_version 2", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 2);
    expect((await rows(wsId)).map((r) => r.hashVersion)).toEqual([2, 2]);
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });

  it("flags a v2 row whose actor_ip was changed", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    const before = await rows(wsId);
    await setRow(wsId, BigInt(2), { actorIp: "10.9.9.9" });
    const r = await verifyChain(wsId);
    expect(r.brokenAt?.entryId).toBe(before[1]!.id);
    expect(r.brokenAt?.reason).toBe("hash_mismatch");
    expect(r.brokenAt?.hint).toMatch(/ENCRYPTION_SECRET/);
  });

  it("flags a v2 row rewritten with recomputed unkeyed sha256 hashes", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    const before = await rows(wsId);
    // What someone with only DB access can do: change the row and recompute
    // every hash from seq 2 on without the key.
    let prev = before[0]!.chainHash;
    for (const row of before.slice(1)) {
      const actorIp = row.seq === BigInt(2) ? "10.9.9.9" : row.actorIp;
      const payloadHash = chain.computePayloadHashV2({
        workspaceId: row.workspaceId,
        action: row.action,
        actorUserId: row.actorUserId,
        actorKind: row.actorKind,
        actorIp: actorIp ?? null,
        actorUserAgent: row.actorUserAgent ?? null,
        targetType: row.targetType,
        targetId: row.targetId,
        meta: row.meta as Record<string, unknown>,
        createdAt: row.createdAt,
      });
      const chainHash = chain.computeChainHash(prev, payloadHash, row.seq);
      await setRow(wsId, row.seq, { actorIp, payloadHash, chainHash, prevHash: prev });
      prev = chainHash;
    }
    const r = await verifyChain(wsId);
    expect(r.brokenAt?.entryId).toBe(before[1]!.id);
  });

  it("accepts a chain of 3 old v1 rows followed by 2 new v2 rows", async () => {
    const { wsId, ownerId } = await newWs();
    let prev: string | null = null;
    for (let seq = 1; seq <= 3; seq++) {
      const createdAt = new Date(Date.now() - (10 - seq) * 1000);
      const v1 = {
        action: "workspace.update",
        actorUserId: ownerId,
        actorKind: "user",
        targetType: "workspace",
        targetId: wsId,
        meta: { seq },
        createdAt,
      };
      const payloadHash = chain.computePayloadHash(v1);
      const chainHash = chain.computeChainHash(prev, payloadHash, BigInt(seq));
      await getDb()
        .insert(schema.auditLog)
        .values({
          id: createId(),
          workspaceId: wsId,
          seq: BigInt(seq),
          prevHash: prev,
          payloadHash,
          chainHash,
          ...v1,
          actorIp: "10.0.0.1",
          actorUserAgent: "old-agent",
        });
      prev = chainHash;
    }
    await append(wsId, ownerId, 2);
    expect((await rows(wsId)).map((r) => r.hashVersion)).toEqual([1, 1, 1, 2, 2]);
    const r = await verifyChain(wsId);
    expect(r.brokenAt).toBeNull();
    expect(r.entriesChecked).toBe(5);
  });

  it("flags a v2 row relabelled as v1 with recomputed v1 hashes (downgrade)", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    const before = await rows(wsId);
    const last = before[2]!;
    const payloadHash = chain.computePayloadHash({
      action: last.action,
      actorUserId: last.actorUserId,
      actorKind: last.actorKind,
      targetType: last.targetType,
      targetId: last.targetId,
      meta: last.meta as Record<string, unknown>,
      createdAt: last.createdAt,
    });
    await setRow(wsId, last.seq, {
      hashVersion: 1,
      payloadHash,
      chainHash: chain.computeChainHash(before[1]!.chainHash, payloadHash, last.seq),
    });
    const r = await verifyChain(wsId);
    expect(r.brokenAt?.entryId).toBe(last.id);
  });

  it("still flags a row deleted from the middle of the chain", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 4);
    await getDb()
      .delete(schema.auditLog)
      .where(and(eq(schema.auditLog.workspaceId, wsId), eq(schema.auditLog.seq, BigInt(2))));
    expect((await verifyChain(wsId)).brokenAt).not.toBeNull();
  });
});

async function appendAt(wsId: string, ownerId: string, n: number, daysAgo: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() - daysAgo * DAY));
  try {
    await append(wsId, ownerId, n);
  } finally {
    vi.useRealTimers();
  }
}

async function purge() {
  const { purgeOldData } = await import("@/lib/retention");
  await purgeOldData({ auditLogsDays: 365, db: getDb() });
}

async function deleteSeqBelow(wsId: string, seq: number) {
  await getDb()
    .delete(schema.auditLog)
    .where(and(eq(schema.auditLog.workspaceId, wsId), lt(schema.auditLog.seq, BigInt(seq))));
}

describe("verifyChain — head trimmed by retention", () => {
  it("retention purges old rows, writes a marker, and the chain verifies", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAt(wsId, ownerId, 2, 400);
    await append(wsId, ownerId, 2);
    await purge();
    const after = await rows(wsId);
    expect(after.map((r) => Number(r.seq))).toEqual([3, 4, 5]);
    expect(after[2]).toMatchObject({
      action: "audit.retention_trimmed",
      actorKind: "system",
      hashVersion: 2,
      meta: { trimmedThroughSeq: "2" },
    });
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });

  it("continues the chain when retention trims every row of a workspace", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAt(wsId, ownerId, 3, 400);
    const tail = (await rows(wsId)).at(-1)!;
    await purge();
    const after = await rows(wsId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      action: "audit.retention_trimmed",
      seq: BigInt(4),
      prevHash: tail.chainHash,
      meta: { trimmedThroughSeq: "3" },
    });
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });

  it("does not raise a false alarm after an inactivity gap", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAt(wsId, ownerId, 3, 400);
    await appendAt(wsId, ownerId, 2, 100);
    await purge();
    expect((await rows(wsId)).map((r) => Number(r.seq))).toEqual([4, 5, 6]);
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });

  it("flags head rows deleted beyond the marker's trimmedThroughSeq", async () => {
    const { wsId, ownerId } = await newWs();
    await appendAt(wsId, ownerId, 2, 400);
    await append(wsId, ownerId, 3);
    await purge();
    await deleteSeqBelow(wsId, 4); // marker covers seq <= 2; seq 3 deleted by hand
    const r = await verifyChain(wsId);
    expect(r.brokenAt?.reason).toBe("head_trimmed_without_marker");
  });

  it("flags a head trimmed with no marker and no AUDIT_V2_SINCE", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 4);
    const before = await rows(wsId);
    await deleteSeqBelow(wsId, 3);
    const r = await verifyChain(wsId);
    expect(r.brokenAt?.entryId).toBe(before[2]!.id);
    expect(r.brokenAt?.reason).toBe("head_trimmed_without_marker");
  });

  it("accepts a pre-marker trim when the first row predates AUDIT_V2_SINCE", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 4);
    await deleteSeqBelow(wsId, 3);
    process.env["AUDIT_V2_SINCE"] = new Date(Date.now() + 60_000).toISOString();
    try {
      expect((await verifyChain(wsId)).brokenAt).toBeNull();
    } finally {
      delete process.env["AUDIT_V2_SINCE"];
    }
  });
});

describe("verifyChain — AUDIT_V2_SINCE", () => {
  // Relabel every row of a v2 chain as v1, recomputing unkeyed hashes from
  // genesis: the one downgrade the seenV2 rule can't see.
  async function relabelAllToV1(wsId: string) {
    let prev: string | null = null;
    for (const row of await rows(wsId)) {
      const payloadHash = chain.computePayloadHash({
        action: row.action,
        actorUserId: row.actorUserId,
        actorKind: row.actorKind,
        targetType: row.targetType,
        targetId: row.targetId,
        meta: row.meta as Record<string, unknown>,
        createdAt: row.createdAt,
      });
      const chainHash = chain.computeChainHash(prev, payloadHash, row.seq);
      await setRow(wsId, row.seq, { hashVersion: 1, payloadHash, chainHash, prevHash: prev });
      prev = chainHash;
    }
  }

  it("without it, an all-v1 relabelled chain still verifies (anchor is the only check)", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    await relabelAllToV1(wsId);
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });

  it("with it, flags a v1 row created after the cutover", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    const first = (await rows(wsId))[0]!;
    await relabelAllToV1(wsId);
    process.env["AUDIT_V2_SINCE"] = since;
    try {
      const r = await verifyChain(wsId);
      expect(r.brokenAt?.entryId).toBe(first.id);
      expect(r.brokenAt?.reason).toBe("downgrade");
    } finally {
      delete process.env["AUDIT_V2_SINCE"];
    }
  });
});

describe("AUDIT_V2_SINCE that doesn't parse", () => {
  it("is reported as a break, and the verify job records it", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 2);
    process.env["AUDIT_V2_SINCE"] = "not-a-date";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect((await verifyChain(wsId)).brokenAt?.reason).toBe("audit_v2_since_invalid");
      const { runVerifyAllChains } = await import("@/lib/audit/verify-job");
      await runVerifyAllChains();
      const events = await getDb()
        .select()
        .from(schema.securityEvents)
        .where(eq(schema.securityEvents.workspaceId, wsId));
      expect(events.map((e) => (e.detail as Record<string, unknown>)["reason"])).toContain(
        "audit_v2_since_invalid"
      );
    } finally {
      delete process.env["AUDIT_V2_SINCE"];
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it("when unset, the verify job warns that downgrade detection is off", async () => {
    const { runVerifyAllChains } = await import("@/lib/audit/verify-job");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await runVerifyAllChains();
      const warned = warnSpy.mock.calls.map((c) => JSON.stringify(c)).join("\n");
      expect(warned).toContain("audit.v2_since_unset");
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});

describe("appendAuditSync — untrusted actorIp", () => {
  it("stores null for a non-IP and the first hop of a forwarded list", async () => {
    const { wsId, ownerId } = await newWs();
    for (const actorIp of ["not-an-ip", "1.2.3.4, 10.0.0.1", "fe80::1%eth0"]) {
      await appendAuditSync(wsId, {
        action: "workspace.update",
        actorUserId: ownerId,
        actorKind: "user",
        actorIp,
        targetType: "workspace",
        targetId: wsId,
        meta: {},
      });
    }
    expect((await rows(wsId)).map((r) => r.actorIp)).toEqual([null, "1.2.3.4", "fe80::1"]);
    expect((await verifyChain(wsId)).brokenAt).toBeNull();
  });
});

describe("runVerifyAllChains — anchor outside the DB", () => {
  it("logs { workspaceId, seq, chainHash } of the last link", async () => {
    const { wsId, ownerId } = await newWs();
    await append(wsId, ownerId, 3);
    const last = (await rows(wsId)).at(-1)!;
    const { runVerifyAllChains } = await import("@/lib/audit/verify-job");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runVerifyAllChains();
      const anchors = infoSpy.mock.calls
        .map((args) => {
          try {
            return JSON.parse(String(args[0])) as Record<string, unknown>;
          } catch {
            return {};
          }
        })
        .filter((l) => l["msg"] === "audit.chain_anchor" && l["workspaceId"] === wsId);
      expect(anchors).toHaveLength(1);
      expect(anchors[0]).toMatchObject({
        workspaceId: wsId,
        seq: last.seq.toString(),
        chainHash: last.chainHash,
      });
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
