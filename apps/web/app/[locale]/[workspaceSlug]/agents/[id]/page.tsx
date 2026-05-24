import { notFound, redirect } from "next/navigation";
import { getDb, schema } from "@orchester/db";
import { eq, and } from "drizzle-orm";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { AgentStudio } from "@/components/agents/studio/AgentStudio";

export default async function AgentStudioPage({
  params,
}: {
  params: Promise<{ id: string; locale: string; workspaceSlug: string }>;
}) {
  const { id, locale, workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws) redirect(`/${locale}/login`);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws.workspace.id)))
    .limit(1);
  const agent = rows[0];
  if (!agent) notFound();
  return (
    <AgentStudio
      agent={{
        id: agent.id,
        name: agent.name,
        role: agent.role,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        status: agent.status,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        teamId: agent.teamId,
        kind: agent.kind,
        flowId: agent.flowId,
        tools: agent.tools,
        variables: agent.variables,
        greeting: agent.greeting,
        fallback: agent.fallback,
        starters: agent.starters,
        avatarUrl: agent.avatarUrl,
        color: agent.color,
        maxTurns: agent.maxTurns,
        responseFormat: agent.responseFormat,
        outputSchema: agent.outputSchema,
      }}
    />
  );
}
