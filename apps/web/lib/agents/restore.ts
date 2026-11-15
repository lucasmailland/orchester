import "server-only";
import { getDb, schema } from "@orchester/db";
import { eq, and, sql } from "drizzle-orm";

/**
 * Restore an agent to a previously saved version snapshot.
 * All captured fields are restored, including tools/variables/responseFormat/outputSchema.
 */
export async function restoreAgentVersion(
  workspaceId: string,
  agentId: string,
  versionId: string
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    const versions = await tx
      .select()
      .from(schema.agentVersions)
      .where(
        and(
          eq(schema.agentVersions.id, versionId),
          eq(schema.agentVersions.agentId, agentId),
          eq(schema.agentVersions.workspaceId, workspaceId)
        )
      )
      .limit(1);
    const v = versions[0];
    if (!v) throw new Error("Version not found");

    await tx
      .update(schema.agents)
      .set({
        systemPrompt: v.systemPrompt,
        model: v.model,
        temperature: v.temperature ?? null,
        maxTokens: v.maxTokens ?? null,
        tools: v.tools ?? [],
        variables: v.variables ?? {},
        responseFormat: v.responseFormat ?? "text",
        outputSchema: v.outputSchema ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agents.id, agentId), eq(schema.agents.workspaceId, workspaceId)));
  });
}
