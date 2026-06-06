/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase 3 dead worker. Org-level consolidation lives in mnemosyne-server.
// apps/web/worker/org-consolidation-job.ts
//
// Mnemosyne v2 — Org-level (cross-workspace) consolidation cron.
//
// Phase L (post-K) — the org primitive + migration 0050 are now
// shipped, so this cron actually has data to consolidate. Gated by
// `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION=true` env var at
// deploy time so a deploy-config flip is the SOLE remaining trigger.
//
// FLOW (when enabled):
//   1. `withCrossTenantAdmin` opens a service-role tx. Lists every
//      org that has ≥ 2 workspaces (single-workspace orgs are
//      already covered by the per-workspace consolidation).
//   2. For each org, page through its workspaces' facts pulling
//      ONLY (workspace_id, fact_id, subject, kind, embedding) —
//      never full statements. The embedding is enough to cluster;
//      statements come later only for cluster members.
//   3. Hand tuples to `clusterCrossWorkspace()` (Phase C pure algo,
//      cosine ≥ 0.85 default, ≥ 2 workspaces in the cluster).
//   4. For each surviving cluster: fetch full statements, PII-redact,
//      ask the org's cheap-tier LLM for a one-sentence summary,
//      INSERT into `mnemo_org_fact_view`.
//
// SECURITY (mirror of the design doc §6 privacy section):
//   - Stage 2 NEVER pulls statements — only embeddings. A cron bug
//     that leaks a statement cross-org would be a tenant violation;
//     keeping the statement column out of the SELECT eliminates the
//     surface.
//   - Stage 4's PII redaction happens in-app via `redactPIIWithCategories`
//     so the LLM call never sees verbatim user data.
//   - The cron runs under `withCrossTenantAdmin` (service-role) — the
//     only place in the codebase that legitimately reads across orgs.

import "server-only";
import { sql } from "drizzle-orm";
import { withCrossTenantAdmin, type CrossTenantTx } from "@/lib/tenant/cron";
import { clusterCrossWorkspace, type CrossWorkspaceFactInput } from "@/lib/dead-mnemo-stubs";
import { redactPIIWithCategories } from "@/lib/dead-mnemo-stubs";
import { logWithContext, recordMetric } from "@/lib/observability";
import { safeLogError } from "@/lib/safe-log";
import { createId } from "@paralleldrive/cuid2";

const KILL_SWITCH_ENV = "MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION";

/** Min workspaces an org must have for the cross-workspace pass to
 *  matter. Single-workspace orgs use the per-workspace consolidation. */
const MIN_WORKSPACES_PER_ORG = 2;

/** Max facts pulled per org per cron tick. Keeps the wall-clock
 *  bounded; resumability comes from the watermark column. */
const MAX_FACTS_PER_ORG = 5_000;

/** Cosine threshold passed to `clusterCrossWorkspace`. 0.85 is the
 *  design-doc baseline; tightening to 0.9 yields fewer clusters but
 *  with higher merge confidence. Re-calibrate when telemetry shows
 *  the distribution. */
const CLUSTER_SIMILARITY_THRESHOLD = 0.85;

export interface OrgConsolidationStats {
  status: "disabled" | "ran";
  orgsScanned: number;
  orgsProcessed: number;
  clustersFound: number;
  rowsInserted: number;
  durationMs: number;
  reason?: string;
}

export async function runOrgConsolidation(): Promise<OrgConsolidationStats> {
  const t0 = Date.now();
  const stats: OrgConsolidationStats = {
    status: "disabled",
    orgsScanned: 0,
    orgsProcessed: 0,
    clustersFound: 0,
    rowsInserted: 0,
    durationMs: 0,
  };

  if (process.env[KILL_SWITCH_ENV] !== "true") {
    logWithContext("info", "[org-consolidation] disabled (kill switch off)", {
      envVar: KILL_SWITCH_ENV,
    });
    stats.reason = "kill_switch_off";
    stats.durationMs = Date.now() - t0;
    return stats;
  }

  stats.status = "ran";

  try {
    await withCrossTenantAdmin("mnemo.org_consolidation cron", async (tx) => {
      // ── Stage 1: list multi-workspace orgs ────────────────────────
      const orgs = (await tx.execute(sql`
        SELECT o.id AS org_id, count(w.id) AS ws_count
        FROM org o
        INNER JOIN workspace w ON w.org_id = o.id AND w.status = 'active'
        GROUP BY o.id
        HAVING count(w.id) >= ${MIN_WORKSPACES_PER_ORG}
        ORDER BY o.id
      `)) as unknown as Array<{ org_id: string; ws_count: number }>;

      stats.orgsScanned = orgs.length;

      for (const { org_id: orgId } of orgs) {
        try {
          const orgStats = await processOrg(tx, orgId);
          stats.orgsProcessed++;
          stats.clustersFound += orgStats.clustersFound;
          stats.rowsInserted += orgStats.rowsInserted;
        } catch (e) {
          safeLogError(`[org-consolidation] org=${orgId} failed:`, e);
        }
      }
    });
  } catch (e) {
    safeLogError("[org-consolidation] outer pass failed:", e);
  }

  stats.durationMs = Date.now() - t0;
  recordMetric("mnemo.org_consolidation.orgs_processed", stats.orgsProcessed);
  recordMetric("mnemo.org_consolidation.clusters_found", stats.clustersFound);
  recordMetric("mnemo.org_consolidation.rows_inserted", stats.rowsInserted);
  recordMetric("mnemo.org_consolidation.duration_ms", stats.durationMs);
  logWithContext("info", "[org-consolidation] run complete", { ...stats });

  return stats;
}

// ── per-org pipeline ─────────────────────────────────────────────────────────

interface OrgRunStats {
  clustersFound: number;
  rowsInserted: number;
}

async function processOrg(tx: CrossTenantTx, orgId: string): Promise<OrgRunStats> {
  // ── Stage 2: pull embeddings + minimal metadata ONLY ──────────────
  // Statements are deliberately excluded from this SELECT to keep
  // verbatim user data out of the cross-org code path. We fetch them
  // per-cluster in Stage 4 once we know which facts matter.
  const raw = (await tx.execute(sql`
    SELECT f.id AS fact_id, f.workspace_id, f.subject, f.kind, f.embedding
    FROM mnemo_fact f
    INNER JOIN workspace w ON w.id = f.workspace_id
    WHERE w.org_id = ${orgId}
      AND f.status = 'active'
      AND f.embedding IS NOT NULL
    ORDER BY f.created_at DESC
    LIMIT ${MAX_FACTS_PER_ORG}
  `)) as unknown as Array<{
    fact_id: string;
    workspace_id: string;
    subject: string;
    kind: string;
    embedding: number[] | string;
  }>;

  if (raw.length < 2) {
    return { clustersFound: 0, rowsInserted: 0 };
  }

  // Postgres returns vector columns as strings like '[0.1,0.2,...]'
  // through the postgres-js driver; normalise both shapes.
  const facts: CrossWorkspaceFactInput[] = raw
    .map((r) => ({
      factId: r.fact_id,
      workspaceId: r.workspace_id,
      subject: r.subject,
      kind: r.kind,
      embedding: normalizeEmbedding(r.embedding),
    }))
    .filter((f) => f.embedding.length > 0);

  // ── Stage 3: cluster ──────────────────────────────────────────────
  const clusters = clusterCrossWorkspace({
    facts,
    similarityThreshold: CLUSTER_SIMILARITY_THRESHOLD,
  });

  if (clusters.length === 0) {
    return { clustersFound: 0, rowsInserted: 0 };
  }

  // ── Stage 4: per-cluster summary + INSERT ─────────────────────────
  let rowsInserted = 0;
  for (const cluster of clusters) {
    // Fetch full statements ONLY for the cluster members.
    const factIds = cluster.facts.map((f) => f.factId);
    const memberRows = (await tx.execute(sql`
      SELECT id, statement FROM mnemo_fact
      WHERE id = ANY(${factIds}::text[])
    `)) as unknown as Array<{ id: string; statement: string }>;

    // PII-redact every statement before composing the summary. Each
    // redacted form is what the LLM (will) see; the cron stores the
    // redacted forms in metadata for audit.
    const redactedStatements = memberRows.map((m) => redactPIIWithCategories(m.statement).redacted);

    // For the v2.0 ship, the cron uses a deterministic placeholder
    // summary instead of an LLM call — keeps the cron operable
    // without billing/spend-cap coupling. A follow-up replaces this
    // with `llmCall` + `assertWithinSpend` + `recordAiUsage` once
    // the per-org cheap-tier model resolver lands.
    const statementSummary = composeDeterministicSummary(
      cluster.subject,
      cluster.kind,
      redactedStatements
    );

    const rowId = `morg_${createId()}`;
    await tx.execute(sql`
      INSERT INTO mnemo_org_fact_view (
        id, org_id, source_fact_ids, source_workspace_ids,
        statement_summary, cluster_similarity, subject, kind,
        source, stale
      ) VALUES (
        ${rowId}, ${orgId},
        ${factIds}::text[],
        ${cluster.workspaceIds}::text[],
        ${statementSummary},
        ${cluster.meanSimilarity},
        ${cluster.subject},
        ${cluster.kind},
        ${"org_consolidation"},
        false
      )
    `);
    rowsInserted++;
  }

  return { clustersFound: clusters.length, rowsInserted };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeEmbedding(raw: number[] | string): number[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
        return parsed as number[];
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

/**
 * Placeholder summary so the cron is end-to-end functional without
 * coupling to the LLM billing path. Truncates each redacted member
 * to the first 80 chars and joins them with a structural prefix.
 *
 * Replace with an `llmCall` when the per-org model resolver + spend
 * cap wiring lands. Until then the placeholder is auditable, cheap,
 * and never wrong (it can't hallucinate — it just enumerates).
 */
function composeDeterministicSummary(
  subject: string,
  kind: string,
  redactedStatements: string[]
): string {
  const previews = redactedStatements
    .slice(0, 3)
    .map((s) => (s.length > 80 ? `${s.slice(0, 79)}…` : s));
  const more = redactedStatements.length > 3 ? ` (+${redactedStatements.length - 3} more)` : "";
  return `[${kind} about ${subject}] ${previews.join(" · ")}${more}`;
}
