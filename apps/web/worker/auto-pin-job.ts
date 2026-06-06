// apps/web/worker/auto-pin-job.ts
//
// Mnemosyne v1.3 — auto-pin daily cron.
//
// Walks every workspace with at least one active mnemo_fact,
// evaluates the pure rule set in `decideAutoPin` against each
// candidate, and PINs the rows that match. Each pinned fact gets
// `metadata.auto_pinned = { rule, at }` stamped so the inspector
// UI can display the auto-pin badge and the user can override.
//
// Override interaction: if the user previously unpinned an
// auto-pinned fact, the unpin route stamped
// `metadata.auto_pinned_overridden = true`. `decideAutoPin` checks
// this flag and returns `reason: 'user_overrode'`, so the user's
// choice wins permanently (the cron will not re-pin until the user
// manually re-pins the row, at which point the pin route clears
// the override flag).
//
// No host-side LLM calls — pure rule evaluation + a small UPDATE per
// pin. The spend-cap / metering invariants in
// `scripts/audit-invariants.sh` don't apply here.
import "server-only";
import { sql } from "drizzle-orm";
import {
  decideAutoPin,
  buildAutoPinStamp,
  withMnemoTx,
  type AutoPinFactInput,
  type Tx,
} from "@/lib/dead-mnemo-stubs";
import { safeLogError } from "@/lib/safe-log";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { CRON_JOBS, shouldRunForWorkspace, markRanForWorkspace } from "@/lib/mnemo/cron-policy";

const MAX_WORKSPACES_PER_RUN = 5000;
/** Per-workspace per-tick cap. Generous because the rule filters
 *  are already narrow (hit_count >= 5 OR conf >= 0.85 + scope=global
 *  + kind in trait/preference). The next tick handles any tail. */
const MAX_CANDIDATES_PER_WORKSPACE = 500;

interface AutoPinStats {
  workspacesScanned: number;
  factsPinned: number;
  workspacesSkipped: number;
}

/**
 * Auto-pin pass for ONE workspace. Selects a small candidate set
 * server-side (anything that PLAUSIBLY matches either rule, so the
 * cron doesn't pull the whole table), then evaluates the pure
 * `decideAutoPin` per row, then UPDATEs the survivors.
 *
 * RLS+FORCE Pattern A is satisfied via withMnemoTx — the role is
 * downgraded to app_user and `app.workspace_id` is set for the
 * duration of the tx, so every SELECT/UPDATE on `mnemo_fact` is
 * tenant-scoped.
 */
async function pinWorkspace(workspaceId: string): Promise<number | null> {
  try {
    return await withMnemoTx(workspaceId, async (tx: Tx) => {
      // Server-side pre-filter: NOT pinned AND status='active' AND
      // (rule-1 candidate OR rule-2 candidate). We keep the predicate
      // wide enough to match either rule; `decideAutoPin` does the
      // exact check (including the override guard).
      type Row = {
        id: string;
        kind: string;
        scope: string;
        confidence: number;
        hit_count: number;
        pinned: boolean;
        created_at: Date;
        metadata: Record<string, unknown> | null;
      };
      const rows = (await tx.execute(sql`
        SELECT id, kind, scope, confidence, hit_count, pinned,
               created_at, metadata
        FROM mnemo_fact
        WHERE workspace_id = ${workspaceId}
          AND status = 'active'
          AND pinned = false
          AND (
            -- rule 1 candidate
            (hit_count >= 5 AND created_at <= now() - interval '14 days')
            OR
            -- rule 2 candidate
            (
              kind IN ('trait','preference')
              AND scope = 'global'
              AND confidence >= 0.85
            )
          )
        ORDER BY hit_count DESC, confidence DESC
        LIMIT ${MAX_CANDIDATES_PER_WORKSPACE}
      `)) as unknown as Row[];

      if (rows.length === 0) return 0;

      const now = new Date();
      let pinned = 0;
      for (const r of rows) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const input: AutoPinFactInput = {
          pinned: r.pinned,
          hitCount: Number(r.hit_count),
          confidence: Number(r.confidence),
          // kind / scope are constrained by the schema enums; we cast
          // here to satisfy the strict input type.
          kind: r.kind as AutoPinFactInput["kind"],
          scope: r.scope as AutoPinFactInput["scope"],
          ageMs: now.getTime() - new Date(r.created_at).getTime(),
          metadata: meta,
        };
        const decision = decideAutoPin(input);
        if (!decision.shouldPin || decision.rule === null) continue;

        const stamp = buildAutoPinStamp(decision.rule, now);
        // jsonb concatenation `||` merges the stamp into the existing
        // metadata. COALESCE handles a NULL metadata column (shouldn't
        // happen — schema default is {} — but cheap insurance).
        const stampJson = JSON.stringify(stamp);
        const updated = await tx.execute(sql`
          UPDATE mnemo_fact
          SET pinned = true,
              metadata = COALESCE(metadata, '{}'::jsonb) || ${stampJson}::jsonb,
              updated_at = now()
          WHERE workspace_id = ${workspaceId}
            AND id = ${r.id}
            -- Defensive: skip if a concurrent user pin/unpin moved
            -- the row out from under us.
            AND pinned = false
            AND status = 'active'
        `);
        // pg-driver's tx.execute returns an array-like result; count
        // length defensively across implementations.
        const rowCount = Array.isArray(updated)
          ? (updated as unknown[]).length
          : ((updated as { rowCount?: number }).rowCount ?? 0);
        if (rowCount > 0) pinned += 1;
      }
      return pinned;
    });
  } catch (err) {
    safeLogError(`[auto-pin] failed (ws=${workspaceId}):`, err);
    return null;
  }
}

/**
 * Cron entry point. Same shape as the other v1.2/v1.3 crons:
 * cross-tenant enumerate via cron_admin BYPASSRLS, then per-workspace
 * apply inside the tenant context.
 */
export async function runAutoPin(): Promise<AutoPinStats> {
  const stats: AutoPinStats = {
    workspacesScanned: 0,
    factsPinned: 0,
    workspacesSkipped: 0,
  };

  const workspaceRows = await withCrossTenantAdmin("mnemo.auto-pin.enumerate", async (tx) => {
    const rows = await tx.execute(sql`
        SELECT DISTINCT workspace_id
        FROM mnemo_fact
        WHERE status = 'active'
        LIMIT ${MAX_WORKSPACES_PER_RUN}
      `);
    return rows as unknown as Array<{ workspace_id: string }>;
  });

  stats.workspacesScanned = workspaceRows.length;
  for (const row of workspaceRows) {
    // Per-workspace periodicity gate. See lib/mnemo/cron-policy.ts.
    const allowed = await shouldRunForWorkspace(row.workspace_id, CRON_JOBS.autoPin);
    if (!allowed) {
      stats.workspacesSkipped += 1;
      continue;
    }
    const pinned = await pinWorkspace(row.workspace_id);
    if (pinned === null) {
      stats.workspacesSkipped += 1;
      continue;
    }
    stats.factsPinned += pinned;
    await markRanForWorkspace(row.workspace_id, CRON_JOBS.autoPin);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "info", msg: "mnemo.auto-pin.done", ...stats }));
  return stats;
}
