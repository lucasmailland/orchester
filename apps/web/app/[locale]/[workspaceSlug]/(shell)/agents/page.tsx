import { getAgents, getTeams } from "@/lib/db-queries";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { AgentsPageClient } from "@/components/agents/AgentsPageClient";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const workspace = await getCurrentWorkspaceBySlug(workspaceSlug);

  const [agents, teams] = workspace
    ? await Promise.all([
        getAgents(workspace.workspace.id).catch(() => []),
        getTeams(workspace.workspace.id).catch(() => []),
      ])
    : [[], []];

  return (
    <AgentsPageClient
      agents={agents.map((a) => ({
        ...a,
        status: a.status as "active" | "inactive" | "draft",
        systemPrompt: a.systemPrompt ?? null,
      }))}
      teams={teams.map((t) => ({ id: t.id, name: t.name, avatarColor: t.avatarColor ?? null }))}
    />
  );
}
