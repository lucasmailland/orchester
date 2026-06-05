import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { ChannelsClient } from "@/components/channels/ChannelsClient";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws) return null;
  const db = getDb();
  const [channels, agents] = await Promise.all([
    db
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.workspaceId, ws.workspace.id))
      .orderBy(desc(schema.channels.updatedAt)),
    db.select().from(schema.agents).where(eq(schema.agents.workspaceId, ws.workspace.id)),
  ]);

  return (
    <ChannelsClient
      channels={channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        status: c.status,
        agentId: c.agentId,
        secret: c.secret,
        hasCredentials: Boolean(c.credentialsEncrypted),
        config: (c.config ?? {}) as Record<string, unknown>,
      }))}
      agents={agents.map((a) => ({ id: a.id, name: a.name, status: a.status }))}
    />
  );
}
