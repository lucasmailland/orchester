// apps/web/lib/brain/decay.ts
//
// Exponential decay of `brain_fact.relevance` over time. Daily cron
// walks every active fact in every workspace, applies:
//
//   relevance' = max(0.05, relevance * exp(-Δt / HALF_LIFE_DAYS))
//
// where Δt is days since `last_recalled_at` (or `created_at` if never
// recalled). Pinned facts are exempt — they never decay.
//
// The floor (0.05) keeps facts visible in scored recall (so a user can
// still find them by typing the exact subject), but pushes them below
// the natural threshold for top-K hybrid ranking.
import "server-only";
import { sql } from "drizzle-orm";
import { withCrossTenantAdmin } from "@/lib/tenant/cron";
import { safeLogError } from "@/lib/safe-log";

const HALF_LIFE_DAYS = 30;
// EXP(-ln(2) * Δt / HALF_LIFE) — true half-life formula. At t=H,
// relevance is exactly halved; at t=2H, quartered; etc.
const HALF_LIFE_SECONDS = HALF_LIFE_DAYS * 86400;

/**
 * Decay every active, non-pinned fact in one cluster-wide pass.
 * Updates `relevance` in-place. Returns total rows touched.
 *
 * Implementation runs entirely in SQL — no per-row roundtrip. The
 * decay formula is computed with `exp(-Δt_seconds / (HALF * 86400))`.
 *
 * Cross-tenant by design: walks every workspace. `cron_admin` role
 * bypasses RLS for this operation; per-workspace facts stay isolated
 * via the RLS policies on the read path.
 */
export async function runBrainDecay(): Promise<number> {
  let touched = 0;
  await withCrossTenantAdmin("brain.decay", async (tx) => {
    try {
      const result = await tx.execute(sql`
        UPDATE brain_fact
        SET relevance = GREATEST(
          0.05,
          relevance * EXP(
            -LN(2) * EXTRACT(EPOCH FROM (now() - COALESCE(last_recalled_at, created_at)))
            / ${HALF_LIFE_SECONDS}::float
          )
        )
        WHERE status = 'active'
          AND pinned = false
          AND relevance > 0.05
      `);
      // postgres-js returns the row count via .count on the result
      const r = result as unknown as { count?: number };
      touched = r.count ?? 0;
      console.log(JSON.stringify({ level: "info", msg: "brain.decay.done", touched }));
    } catch (e) {
      safeLogError("[brain.decay] failed:", e);
      throw e;
    }
  });
  return touched;
}
