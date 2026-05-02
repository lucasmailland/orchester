import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { KnowledgeListClient } from "@/components/knowledge/KnowledgeListClient";

export default async function KnowledgePage() {
  const ws = await getCurrentWorkspace();
  if (!ws) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.knowledgeBases)
    .where(eq(schema.knowledgeBases.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.knowledgeBases.updatedAt));
  return (
    <KnowledgeListClient
      kbs={rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        embeddingProvider: r.embeddingProvider,
        embeddingModel: r.embeddingModel,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
