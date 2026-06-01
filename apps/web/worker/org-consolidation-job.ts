// apps/web/worker/org-consolidation-job.ts
//
// Mnemosyne v2 — Org-level (cross-workspace) consolidation cron.
//
// **STATUS: SCAFFOLD ONLY — DISABLED BY DEFAULT + ARCHITECTURALLY BLOCKED.**
//
// As of 2026-05-30 the codebase has NO `org` table — only `workspace`.
// The cross-workspace consolidation design (see
// docs/specs/2026-05-30-cross-workspace-consolidation-design.md §0)
// assumes an org boundary that doesn't exist. Until a product
// decision lands on the tenancy primitive, this file is a placeholder
// that intentionally does nothing.
//
// This file lands the orchestration shell + feature-flag gate so the
// wire is reviewable independent of the (still-pending) data-path
// implementation. The actual cross-workspace data path is GATED on:
//
//   1. An `org` primitive (table + workspace.org_id FK + Drizzle
//      schema). Currently MISSING — see the design doc §0.
//   2. Migration 0050 (`mnemo_org_fact_view` + `app_org_user` role +
//      RLS policy) — depends on (1).
//   3. Legal/security signoff per the design doc §6 (privacy + GDPR).
//   4. The `MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION=true` env var.
//      Default off; safe rollout requires explicit deploy-time opt-in.
//
// When BOTH gates are open, the job:
//   a. Fans out per-org via `withCrossTenantAdmin` (mirror of the
//      per-workspace consolidation cron).
//   b. For each org, fetches embedding + (workspace_id, fact_id,
//      subject, kind) tuples ONLY — never full statements — via a
//      service-role query.
//   c. Hands the tuples to the pure `clusterCrossWorkspace()`
//      algorithm (already shipped, see Phase C / commit deb455b).
//   d. For each surviving cluster, fetches full statements, PII-
//      redacts, and asks the org's cheap-tier LLM for a one-sentence
//      summary. Result is inserted into `mnemo_org_fact_view`.
//
// Today, with the gates closed, this file is a no-op that emits a
// single info-level log line per cron tick announcing it's disabled.
// That log line is intentional — it's the smoke signal that tells an
// operator the wire is connected end-to-end so the only thing left
// to do at gate-open time is land the migration + flip the flag.

import "server-only";
import { logWithContext } from "@/lib/observability";

/**
 * Global kill switch. Default: undefined (off). Set to "true" only
 * after migration 0050 is applied AND legal/security signoff is on
 * file. Per-org feature flag will replace this once the org table
 * exists and we have an `isFeatureEnabledForOrg` helper to call from
 * cron (workspace-scoped flags don't fit cron-time per-org gating).
 *
 * The ENV name is intentionally verbose so a grep for it in deploy
 * config is unambiguous about what it enables.
 */
const KILL_SWITCH_ENV = "MNEMO_ENABLE_CROSS_WORKSPACE_CONSOLIDATION";

/**
 * Cron entry point. Wired into the pg-boss schedule alongside the
 * per-workspace `consolidation-job` (same weekly cadence; see
 * `apps/web/worker/index.ts`). Runs AFTER the per-workspace pass so
 * each workspace's local consolidation has already settled before
 * the cross-workspace scan begins.
 */
export async function runOrgConsolidation(): Promise<{
  status: "disabled" | "ran";
  orgsProcessed: number;
  reason?: string;
}> {
  // ── Gate 1: migration check (placeholder until 0050 lands). ─────────
  // We don't probe the DB for the table here — that would mean
  // SHIPPING a service-role connection to this file BEFORE the
  // migration exists, which is exactly the path the design doc
  // forbids ("we are not letting any cron bypass [RLS]"). Instead,
  // the migration check is the FEATURE FLAG: if the flag is enabled,
  // we assume the operator confirmed the migration is applied.
  //
  // When the migration lands, replace this comment with the real
  // probe — a service-role `SELECT 1 FROM mnemo_org_fact_view LIMIT 0`
  // that surfaces a clear error if the table is absent.

  // ── Gate 2: global kill switch (per-org flag wiring lands with the
  // migration). The ENV name is checked literally — no truthy coercion,
  // only "true" enables. Anything else is interpreted as off so
  // mis-set values fail safe.
  const globalEnabled = process.env[KILL_SWITCH_ENV] === "true";

  if (!globalEnabled) {
    logWithContext("info", "[org-consolidation] disabled (kill switch off)", {
      envVar: KILL_SWITCH_ENV,
    });
    return { status: "disabled", orgsProcessed: 0, reason: "kill_switch_off" };
  }

  // ── Body (placeholder until migration 0050 lands). ─────────────────
  //
  // The implementation will, when ungated:
  //
  //   1. List orgs via `withCrossTenantAdmin` (service-role SELECT
  //      on `org` table).
  //   2. For each org, page through its workspaces in chunks (spec §9
  //      throttling — large orgs need a `last_consolidated_at`
  //      watermark for incremental scans).
  //   3. SELECT (workspace_id, fact_id, subject, kind, embedding)
  //      FROM mnemo_fact across the org's workspaces. EMBEDDING +
  //      MINIMAL METADATA ONLY — never full statements.
  //   4. Hand tuples to `clusterCrossWorkspace()` (pure algorithm,
  //      already shipped in commit deb455b).
  //   5. For each surviving cluster: fetch full statements (with PII
  //      redaction), call the org's cheap-tier LLM with
  //      `assertWithinSpend` + `recordAiUsage`, INSERT INTO
  //      mnemo_org_fact_view.
  //
  // The gate is closed by `if (!globalEnabled) return` above. This
  // arm is unreachable today; it'll become the wiring point once
  // the migration + signoff land.
  logWithContext("warn", "[org-consolidation] enabled but no impl — pending migration 0050", {
    envVar: KILL_SWITCH_ENV,
  });
  return {
    status: "ran",
    orgsProcessed: 0,
    reason: "scaffold_only_pending_migration_0050",
  };
}
