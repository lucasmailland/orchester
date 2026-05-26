// packages/mnemosyne/src/health/index.ts
//
// Public surface for the Mnemosyne v1.2 memory drift detection.
//
//   - `computeHealthSnapshot` — pure metrics calculation (./compute.ts).
//     Re-exported here for convenience.
//   - `persistHealthSnapshot` — write the snapshot into `mnemo_health`.
//   - `getHealthSnapshot` — fetch the latest persisted snapshot for a
//     workspace, or optionally recompute on the fly.
//
// All three respect RLS+FORCE: when the caller doesn't supply a tx, we
// open a workspace-scoped one via `withMnemoTx` so `app.workspace_id`
// is set and the role is downgraded to `app_user`. When the caller DOES
// supply a tx, we trust them to have set up the workspace GUC.
//
// §0.1: package-clean — no `server-only`, no host imports.
import { createId } from "@paralleldrive/cuid2";
import { desc, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { withMnemoTx, type Tx } from "../tx";
import { computeHealthSnapshot, type HealthSnapshot } from "./compute";

export {
  computeHealthSnapshot,
  type HealthSnapshot,
  type ComputeHealthSnapshotInput,
} from "./compute";

export interface GetHealthSnapshotInput {
  workspaceId: string;
  /**
   * When true, recompute the snapshot now AND persist it. When false
   * (default), return the most recently persisted snapshot or null
   * when none exist yet.
   */
  fresh?: boolean;
  /**
   * Optional active tx. If supplied the caller owns the lifecycle and
   * MUST have set `app.workspace_id` already (this is the cron path).
   * Otherwise we open a workspace-scoped tx via `withMnemoTx`.
   */
  tx?: Tx;
}

/**
 * Return the workspace's latest persisted snapshot. When `fresh: true`,
 * recompute now and persist it before returning the freshly-written row.
 *
 * Returns `null` only when no snapshot has ever been persisted AND
 * `fresh` is false. In that mode the API endpoint can decide whether to
 * trigger a compute or return "no data yet" to the caller.
 */
export async function getHealthSnapshot(
  input: GetHealthSnapshotInput
): Promise<HealthSnapshot | null> {
  const run = async (tx: Tx): Promise<HealthSnapshot | null> => {
    if (input.fresh) {
      const snap = await computeHealthSnapshot({ workspaceId: input.workspaceId, tx });
      await persistHealthSnapshot({ workspaceId: input.workspaceId, snapshot: snap, tx });
      return snap;
    }
    return readLatestSnapshot(input.workspaceId, tx);
  };

  if (input.tx) return run(input.tx);
  return withMnemoTx(input.workspaceId, (tx) => run(tx as Tx));
}

export interface PersistHealthSnapshotInput {
  workspaceId: string;
  snapshot: HealthSnapshot;
  tx: Tx;
}

/**
 * Insert a single `mnemo_health` row. Each snapshot is append-only —
 * we don't upsert by (workspace_id, day) because the dashboard wants
 * the full timeseries, including any ad-hoc on-demand recomputes
 * triggered by an operator. The unique key is the implicit primary
 * key (`id`); de-duplication by tick is the cron's responsibility
 * (it runs once a day per workspace).
 */
export async function persistHealthSnapshot(input: PersistHealthSnapshotInput): Promise<void> {
  const { workspaceId, snapshot, tx } = input;
  const id = `mh_${createId()}`;
  await tx.insert(schema.mnemoHealth).values({
    id,
    workspaceId,
    snapshotAt: snapshot.snapshotAt,
    factCountActive: snapshot.factCountActive,
    factCountArchived: snapshot.factCountArchived,
    factCountEmbedded: snapshot.factCountEmbedded,
    factCountUnembedded: snapshot.factCountUnembedded,
    decisionCountActive: snapshot.decisionCountActive,
    relationCountConflicts: snapshot.relationCountConflicts,
    factsWithZeroHits: snapshot.factsWithZeroHits,
    // numeric columns take strings in drizzle-orm to avoid float-precision
    // loss; `recallHitRate30d` is at most numeric(4,3) so 3-decimal
    // rounding is enough.
    recallHitRate30d:
      snapshot.recallHitRate30d === null ? null : snapshot.recallHitRate30d.toFixed(3),
    extractionJobsFailed7d: snapshot.extractionJobsFailed7d,
    extractionJobsDeferred: snapshot.extractionJobsDeferred,
    computedInMs: snapshot.computedInMs,
  });
}

/**
 * Read the most recent row, mapping it back into the `HealthSnapshot`
 * shape (so callers never see drizzle-internal types). Returns null
 * when no rows exist for the workspace.
 */
async function readLatestSnapshot(workspaceId: string, tx: Tx): Promise<HealthSnapshot | null> {
  const rows = await tx
    .select()
    .from(schema.mnemoHealth)
    .where(eq(schema.mnemoHealth.workspaceId, workspaceId))
    .orderBy(desc(schema.mnemoHealth.snapshotAt))
    .limit(1);
  const r = rows[0] as
    | {
        workspaceId: string;
        snapshotAt: Date;
        factCountActive: number;
        factCountArchived: number;
        factCountEmbedded: number;
        factCountUnembedded: number;
        decisionCountActive: number;
        relationCountConflicts: number;
        factsWithZeroHits: number;
        recallHitRate30d: string | null;
        extractionJobsFailed7d: number;
        extractionJobsDeferred: number;
        computedInMs: number;
      }
    | undefined;
  if (!r) return null;
  return {
    workspaceId: r.workspaceId,
    snapshotAt: r.snapshotAt instanceof Date ? r.snapshotAt : new Date(r.snapshotAt),
    factCountActive: r.factCountActive,
    factCountArchived: r.factCountArchived,
    factCountEmbedded: r.factCountEmbedded,
    factCountUnembedded: r.factCountUnembedded,
    decisionCountActive: r.decisionCountActive,
    relationCountConflicts: r.relationCountConflicts,
    factsWithZeroHits: r.factsWithZeroHits,
    recallHitRate30d: r.recallHitRate30d === null ? null : Number(r.recallHitRate30d),
    extractionJobsFailed7d: r.extractionJobsFailed7d,
    extractionJobsDeferred: r.extractionJobsDeferred,
    computedInMs: r.computedInMs,
  };
}
