// apps/web/lib/gdpr/exporters/workspace.ts
//
// Per-table exporters for a single workspace. Each function returns the
// rows for ONE table so the streaming zip builder can append JSON files
// one at a time (avoids holding the whole snapshot in memory).
//
// Phase E.6 ships only the workspace metadata exporter; the remaining
// tables (agents, conversations, knowledge_base, …) are stubbed in
// `docs/specs/plans/phase-e-followups.md`.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";

export async function exportWorkspace(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}
