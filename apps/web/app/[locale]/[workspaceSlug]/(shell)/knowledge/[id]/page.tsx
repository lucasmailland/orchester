import { notFound } from "next/navigation";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { KnowledgeDetailClient } from "@/components/knowledge/KnowledgeDetailClient";

export default async function KbDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getCurrentWorkspace();
  if (!ws) return null;
  const db = getDb();
  const kbRows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(
      and(eq(schema.knowledgeBases.id, id), eq(schema.knowledgeBases.workspaceId, ws.workspace.id))
    )
    .limit(1);
  const kb = kbRows[0];
  if (!kb) notFound();
  const docs = await db
    .select()
    .from(schema.knowledgeDocs)
    .where(
      and(eq(schema.knowledgeDocs.kbId, id), eq(schema.knowledgeDocs.workspaceId, ws.workspace.id))
    )
    .orderBy(desc(schema.knowledgeDocs.createdAt));
  return (
    <KnowledgeDetailClient
      kb={{
        id: kb.id,
        name: kb.name,
        description: kb.description,
        embeddingProvider: kb.embeddingProvider,
        embeddingModel: kb.embeddingModel,
      }}
      docs={docs.map((d) => ({
        id: d.id,
        title: d.title,
        source: d.source ?? "text",
        status: d.status,
        chunkCount: d.chunkCount,
        error: d.error,
        createdAt: d.createdAt.toISOString(),
      }))}
    />
  );
}
