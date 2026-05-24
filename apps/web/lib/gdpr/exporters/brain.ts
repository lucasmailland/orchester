// apps/web/lib/gdpr/exporters/brain.ts
//
// Per-workspace GDPR export of Brain Core facts. Embedding column is
// stripped — 1536 floats × N facts would bloat the zip 5-10× without
// useful info to the data subject (they get the statement text).
import "server-only";
import { and, eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import type { ExporterDb } from "./workspace";

export async function exportBrain(workspaceId: string, db: ExporterDb) {
  const rows = await db
    .select({
      id: schema.brainFacts.id,
      agentId: schema.brainFacts.agentId,
      scope: schema.brainFacts.scope,
      scopeRef: schema.brainFacts.scopeRef,
      kind: schema.brainFacts.kind,
      subject: schema.brainFacts.subject,
      statement: schema.brainFacts.statement,
      confidence: schema.brainFacts.confidence,
      pinned: schema.brainFacts.pinned,
      relevance: schema.brainFacts.relevance,
      hitCount: schema.brainFacts.hitCount,
      lastRecalledAt: schema.brainFacts.lastRecalledAt,
      sourceMessageIds: schema.brainFacts.sourceMessageIds,
      metadata: schema.brainFacts.metadata,
      status: schema.brainFacts.status,
      mergedIntoId: schema.brainFacts.mergedIntoId,
      createdAt: schema.brainFacts.createdAt,
      updatedAt: schema.brainFacts.updatedAt,
    })
    .from(schema.brainFacts)
    .where(
      and(
        eq(schema.brainFacts.workspaceId, workspaceId),
        eq(schema.brainFacts.status, "active")
      )
    );
  return rows;
}
