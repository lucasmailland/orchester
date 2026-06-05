// apps/web/lib/mnemo/warm-up.ts
//
// Cold-workspace warm-up gate for the extraction pipeline.
//
// Why this exists
// ---------------
// Mnemosyne's recall pays back only when there's a corpus to recall
// FROM. The very first conversations in a fresh workspace produce no
// usable recall hits (nothing to retrieve), yet still pay the full
// extraction cost (~$0.0001–0.0005 per conversation in cheap-tier LLM
// fees + an embed call per fact). For workspaces that may never grow
// past a handful of conversations — pilots, evaluations, abandoned
// trials — that's burned money.
//
// The warm-up gate skips extraction until the workspace clears a
// minimum activity bar:
//   - At least `MIN_CONVERSATIONS_FOR_WARMUP` conversations exist
//     (default 10).
//
// The threshold is deliberately conservative — past the elbow on the
// "is this an active workspace?" curve. Once cleared, every future
// conversation extracts as normal. The flag is computed live (no
// persisted "warmed_up_at" column) so a workspace that drops back
// below the threshold (rare — conversations are append-only) would
// also re-cool, but that's a non-issue in practice.
//
// Configurability
// ---------------
// Per-workspace override knob: a row in `mnemo_cron_schedule` for the
// future `extract` job (not currently wired into the
// cron-policy.ts gate — extraction is event-driven, not cron-driven)
// would let the operator opt OUT of warm-up. For now the threshold
// is global; we can promote it to a per-workspace setting when a
// real ask shows up.
//
// Observability
// -------------
// The job logs `mnemo.extract.skipped.cold` so dashboards can quantify
// "facts NOT extracted because the workspace is still cold." Once an
// operator sees this on a clearly-active workspace they can lower the
// threshold via env (MNEMO_WARMUP_MIN_CONVS).

import "server-only";
import { sql } from "drizzle-orm";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";

/**
 * Minimum conversation count for a workspace to clear warm-up. Read
 * once at module load — bumping the env requires a worker restart,
 * which is fine for a global tuning knob.
 */
const MIN_CONVERSATIONS_FOR_WARMUP = Math.max(
  1,
  Number(process.env["MNEMO_WARMUP_MIN_CONVS"] ?? 10)
);

interface WarmUpStatus {
  /** True when extraction should proceed for this workspace. */
  warmedUp: boolean;
  /** How many conversations the workspace currently has. */
  conversationCount: number;
  /** The bar the workspace needs to clear. */
  threshold: number;
}

/**
 * Cheap per-(workspace) COUNT against `conversation` table. The
 * cross-tenant admin connection bypasses RLS so this works from the
 * worker entry point that doesn't have a tx up the call chain.
 *
 * Errors fail OPEN — a transient DB blip can't silently disable
 * extraction for everyone. Logs are emitted by the caller (extract-job)
 * so we don't double-log here.
 */
export async function checkWarmUp(workspaceId: string): Promise<WarmUpStatus> {
  const count = await withCrossTenantAdmin("mnemo.warm-up.count-conversations", async (tx) => {
    const result = await tx.execute<{ count: number }>(sql`
        SELECT COUNT(*)::int AS count
        FROM conversation
        WHERE workspace_id = ${workspaceId}
      `);
    // drizzle's `.execute` shape varies by driver; `.rows` is the
    // postgres-js convention. Default to 0 on the unhappy path so
    // we fail open (no extraction skip on a count read error).
    const rows = (result as unknown as { rows?: Array<{ count: number }> }).rows ?? [];
    return rows[0]?.count ?? 0;
  });

  return {
    warmedUp: count >= MIN_CONVERSATIONS_FOR_WARMUP,
    conversationCount: count,
    threshold: MIN_CONVERSATIONS_FOR_WARMUP,
  };
}

/**
 * Convenience boolean shortcut for call sites that only need the
 * decision and not the telemetry.
 */
export async function shouldExtractForWorkspace(workspaceId: string): Promise<boolean> {
  try {
    const status = await checkWarmUp(workspaceId);
    return status.warmedUp;
  } catch {
    // Fail open — extraction should be the safe default.
    return true;
  }
}
