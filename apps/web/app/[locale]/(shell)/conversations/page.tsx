import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { ConversationsClient } from "@/components/conversations/ConversationsClient";

export default async function ConversationsPage() {
  const ws = await getCurrentWorkspace();
  if (!ws) return null;
  const db = getDb();
  const [agents, labels] = await Promise.all([
    db
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, ws.workspace.id)),
    db
      .select()
      .from(schema.conversationLabels)
      .where(eq(schema.conversationLabels.workspaceId, ws.workspace.id))
      .orderBy(desc(schema.conversationLabels.createdAt)),
  ]);
  return (
    <ConversationsClient
      agents={agents}
      labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
    />
  );
}
