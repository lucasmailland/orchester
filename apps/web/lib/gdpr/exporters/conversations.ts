// apps/web/lib/gdpr/exporters/conversations.ts
//
// Dump every conversation row for the workspace, plus the workspace's
// conversation labels (small companion table). Messages live in a
// separate exporter because they're the largest per-workspace
// collection and we want them in their own JSON file inside the zip.
//
// Conversation rows carry customer PII (email, name, external IDs) —
// those are the whole point of the export. We don't redact them.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { ExporterDb } from "./workspace";

export async function exportConversations(workspaceId: string, db?: ExporterDb) {
  const client = db ?? getDb();

  // Sequential awaits (no Promise.all): when `client` is a shared
  // transaction handle, parallel queries collide on the single
  // postgres-js connection. See the matching note in `agents.ts`.
  const conversations = await client
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.workspaceId, workspaceId));
  const labels = await client
    .select()
    .from(schema.conversationLabels)
    .where(eq(schema.conversationLabels.workspaceId, workspaceId));

  return { conversations, labels };
}
