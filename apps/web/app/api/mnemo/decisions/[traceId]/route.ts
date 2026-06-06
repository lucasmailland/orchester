// GET /api/mnemo/decisions/[traceId] — Memory Inspector "Decision BOM"
// endpoint. Joins audit + trust + policy + trace into one record.
//
// The traceId comes from /api/mnemo/recall-debug which stashes it in
// `audit_log.meta.traceId`. We pull every audit row whose meta carries
// that traceId — that gives us the audit slice. Trace events come from
// the inspector.recall_debug meta payload itself. Policy snapshot is
// the live STAGE_CAP_BY_TIER + a small set of env flags. Trust
// snapshot is computed from the workspace's fact count.
//
// If no audit row matches the traceId we return {available: false}
// instead of 404 so the UI shows a "BOM expired or unavailable" state.
// Audit rows age out per the retention policy.
//
// SCOPE: viewer+ (same RBAC tier as recall-debug).
// RLS: workspace_id is bound to the route context, never read from
// user input. Fact-count query runs through withMnemoTx.

import "server-only";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import {
  composeBOM,
  completenessScore,
  withMnemoTx,
  type RecallMetricEvent,
} from "@/lib/dead-mnemo-stubs";
import { getDb } from "@orchester/db";
import { requireAuth, isAuthContext } from "@/lib/auth-guards";
import { safeLogError } from "@/lib/safe-log";

export const dynamic = "force-dynamic";

/** AGT parity: ±5s window around decisionAt. */
const BOM_WINDOW_MS = 5_000;

/** Env flags surfaced into the policy snapshot. Keep this list short
 *  — the BOM is downloaded by humans and noisy flags hurt readability. */
const TRACKED_FLAGS = [
  "MNEMO_REJECT_POISONING",
  "MNEMO_TRUST_DECAY",
  "MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION",
] as const;

interface AuditRow {
  id: string;
  seq: string;
  action: string;
  actor_user_id: string | null;
  actor_kind: string;
  target_type: string;
  target_id: string;
  meta: Record<string, unknown>;
  created_at: Date;
}

export async function GET(_req: Request, context: { params: Promise<{ traceId: string }> }) {
  // Kill-switch: MNEMO_DECISION_BOM=false disables the endpoint entirely.
  // Omit or set to "true" to enable (default ON — consistent with the
  // other AGT-borrow flags). Returns graceful-degrade shape so the UI
  // shows "BOM unavailable" rather than an error toast.
  if (process.env["MNEMO_DECISION_BOM"] === "false") {
    return NextResponse.json({ available: false, reason: "feature_disabled" });
  }

  const ctx = await requireAuth({ minRole: "viewer" });
  if (!isAuthContext(ctx)) return ctx;

  const { traceId } = await context.params;
  if (!traceId || !/^trace_[A-Za-z0-9]+$/.test(traceId)) {
    return NextResponse.json({ error: "invalid_trace_id" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Step 1: locate the inspector.recall_debug row that owns this traceId.
    const seedRows = (await db.execute(sql`
      SELECT id, seq::text AS seq, action, actor_user_id, actor_kind,
             target_type, target_id, meta, created_at
      FROM audit_log
      WHERE workspace_id = ${ctx.workspace.id}
        AND action = 'inspector.recall_debug'
        AND meta ->> 'traceId' = ${traceId}
      LIMIT 1
    `)) as unknown as AuditRow[];

    const seed = seedRows[0];
    if (!seed) {
      return NextResponse.json({
        available: false,
        reason: "trace_not_found",
      });
    }

    const decisionAt = new Date(seed.created_at);
    const windowStart = new Date(decisionAt.getTime() - BOM_WINDOW_MS);
    const windowEnd = new Date(decisionAt.getTime() + BOM_WINDOW_MS);

    // Step 2: audit slice — every row in the ±5s window.
    const auditRows = (await db.execute(sql`
      SELECT id, seq::text AS seq, action, actor_user_id, actor_kind,
             target_type, target_id, meta, created_at
      FROM audit_log
      WHERE workspace_id = ${ctx.workspace.id}
        AND created_at BETWEEN ${windowStart} AND ${windowEnd}
      ORDER BY seq ASC
    `)) as unknown as AuditRow[];

    // Step 3: trust slice — fact count for the workspace.
    const factCount = await withMnemoTx(ctx.workspace.id, async (tx) => {
      const r = (await tx.execute(sql`
        SELECT count(*)::int AS c
        FROM mnemo_fact
        WHERE workspace_id = ${ctx.workspace.id}
          AND status = 'active'
      `)) as unknown as Array<{ c: number }>;
      return r[0]?.c ?? 0;
    });

    // Step 4: trace slice — pulled straight from seed meta.
    const traceEvents = (
      Array.isArray(seed.meta["events"]) ? (seed.meta["events"] as RecallMetricEvent[]) : []
    ) as RecallMetricEvent[];
    const outcome = {
      hits: typeof seed.meta["hits"] === "number" ? (seed.meta["hits"] as number) : 0,
      totalMs: typeof seed.meta["totalMs"] === "number" ? (seed.meta["totalMs"] as number) : 0,
    };

    // Step 5: policy slice — env flags.
    const flags: Record<string, string> = {};
    for (const k of TRACKED_FLAGS) {
      const v = process.env[k];
      if (v !== undefined) flags[k] = v;
    }

    const bom = composeBOM({
      traceId,
      workspaceId: ctx.workspace.id,
      decisionAt,
      identity: {
        userId: ctx.user.id,
        agentId: typeof seed.meta["agentId"] === "string" ? (seed.meta["agentId"] as string) : null,
        role: ctx.role,
      },
      factCount,
      flags,
      traceEvents,
      auditEntries: auditRows.map((r) => ({
        id: r.id,
        seq: BigInt(r.seq),
        action: r.action,
        actorUserId: r.actor_user_id,
        actorKind: r.actor_kind,
        targetType: r.target_type,
        targetId: r.target_id,
        meta: r.meta,
        createdAt: new Date(r.created_at),
      })),
      windowMs: BOM_WINDOW_MS,
      outcome,
    });

    return NextResponse.json({
      available: true,
      bom,
      completeness: completenessScore(bom),
    });
  } catch (e) {
    safeLogError("[mnemo/decisions] BOM compose failed:", e);
    return NextResponse.json({ available: false, reason: "internal_error" }, { status: 200 });
  }
}
