import { getAgents, getTeams } from "@/lib/db-queries";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AgentsPageClient } from "@/components/agents/AgentsPageClient";

export default async function AgentsPage() {
  const workspace = await getCurrentWorkspace();

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
