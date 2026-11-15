import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and, count } from "drizzle-orm";

export interface KbPatch {
  name?: string;
  description?: string | null;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  embeddingProvider?: string;
}

/**
 * KNOW-10: update a knowledge base. When embeddingModel/embeddingProvider change,
 * enforces that the KB has no indexed chunks (changing the model on an already-
 * embedded KB would leave the vectors incompatible with new ones).
 */
export async function updateKnowledgeBase(
  workspaceId: string,
  id: string,
  patch: KbPatch
): Promise<void> {
  const db = getDb();

  if (patch.embeddingModel !== undefined || patch.embeddingProvider !== undefined) {
    const [result] = await db
      .select({ n: count() })
      .from(schema.knowledgeChunks)
      .where(
        and(
          eq(schema.knowledgeChunks.kbId, id),
          eq(schema.knowledgeChunks.workspaceId, workspaceId)
        )
      );
    if (result && result.n > 0) {
      throw new Error(
        "re-index required: delete all documents before changing the embedding model."
      );
    }
  }

  const { name, description, chunkSize, chunkOverlap, embeddingModel, embeddingProvider } = patch;
  await db
    .update(schema.knowledgeBases)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(chunkSize !== undefined && { chunkSize }),
      ...(chunkOverlap !== undefined && { chunkOverlap }),
      ...(embeddingModel !== undefined && { embeddingModel }),
      ...(embeddingProvider !== undefined && { embeddingProvider }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.knowledgeBases.id, id), eq(schema.knowledgeBases.workspaceId, workspaceId))
    );
}
