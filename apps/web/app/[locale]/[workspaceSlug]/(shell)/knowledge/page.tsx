import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { KnowledgeListClient } from "@/components/knowledge/KnowledgeListClient";

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
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
