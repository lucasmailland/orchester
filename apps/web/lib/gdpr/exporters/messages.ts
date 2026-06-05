// apps/web/lib/gdpr/exporters/messages.ts
//
// Dump every message for the workspace. `message` doesn't carry its
// own `workspace_id` column — it lives under `conversation`, so we
// scope via an inner join on `conversation.workspace_id`. That's also
// how Drizzle's RLS predicate is shaped for this table in production.
//
// This is typically the heaviest single file in the archive
// (≫ conversations). The current implementation buffers everything
// in memory; when we move to true streaming this becomes a paginated
// cursor that streams JSON to the archiver entry directly.
import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@orchester/db";
import { redactSecrets } from "../redact";
import type { ExporterDb } from "./workspace";

export async function exportMessages(workspaceId: string, db: ExporterDb) {
  // Single query — already sequential by construction. Join messages →
  // conversations to filter by workspaceId, then project only the
  // message columns so the shape stays clean for the downstream
  // consumer.
  const rows = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      role: schema.messages.role,
      content: schema.messages.content,
      tokensUsed: schema.messages.tokensUsed,
      costUsd: schema.messages.costUsd,
      model: schema.messages.model,
      authorUserId: schema.messages.authorUserId,
      fromOperator: schema.messages.fromOperator,
      metadata: schema.messages.metadata,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
    .where(eq(schema.conversations.workspaceId, workspaceId));

  // Phase F.3 (2026-05-26): scrub `metadata` defensively. The JSONB
  // column is written by router.ts (quota / handoff / budget reasons,
  // benign today) and by tools.ts; future handlers could land an
  // upstream tool response there and leak credentials through the
  // export. The structured exporter is hardened by column-selection
  // but the JSON shape isn't. Walk + redact every metadata payload.
  const scrubbed = rows.map((m) => ({
    ...m,
    metadata: redactSecrets(m.metadata),
  }));

  return { messages: scrubbed };
}
