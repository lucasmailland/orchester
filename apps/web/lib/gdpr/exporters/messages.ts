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
import { getDb, schema } from "@orchester/db";
import type { ExporterDb } from "./workspace";

export async function exportMessages(workspaceId: string, db?: ExporterDb) {
  const client = db ?? getDb();

  // Join messages → conversations to filter by workspaceId, then
  // project only the message columns so the shape stays clean for the
  // downstream consumer.
  const rows = await client
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

  return { messages: rows };
}
