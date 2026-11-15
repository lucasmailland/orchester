import { schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { ConversationsClient } from "@/components/conversations/ConversationsClient";

const PAGE_SIZE = 50;

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ws = await getCurrentWorkspaceBySlug(workspaceSlug);
  if (!ws) return null;
  const wsId = ws.workspace.id;

  const [agents, labels, firstPage] = await Promise.all([
    withWorkspaceTx(wsId, (tx) =>
      tx
        .select({ id: schema.agents.id, name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.workspaceId, wsId))
    ),
    withWorkspaceTx(wsId, (tx) =>
      tx
        .select()
        .from(schema.conversationLabels)
        .where(eq(schema.conversationLabels.workspaceId, wsId))
        .orderBy(desc(schema.conversationLabels.createdAt))
    ),
    withWorkspaceTx(wsId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.conversations.id,
          status: schema.conversations.status,
          channelType: schema.channels.type,
          channelName: schema.channels.name,
          agentId: schema.conversations.agentId,
          agentName: schema.agents.name,
          employeeName: schema.employees.name,
          employeeEmail: schema.employees.email,
          customerName: schema.conversations.customerName,
          customerEmail: schema.conversations.customerEmail,
          tags: schema.conversations.tags,
          csat: schema.conversations.csat,
          messageCount: schema.conversations.messageCount,
          startedAt: schema.conversations.startedAt,
          takenOverAt: schema.conversations.takenOverAt,
          summary: schema.conversations.summary,
          totalCostUsd: schema.conversations.totalCostUsd,
          totalTokens: schema.conversations.totalTokens,
        })
        .from(schema.conversations)
        .leftJoin(schema.channels, eq(schema.channels.id, schema.conversations.channelId))
        .leftJoin(schema.employees, eq(schema.employees.id, schema.conversations.employeeId))
        .leftJoin(schema.agents, eq(schema.agents.id, schema.conversations.agentId))
        .where(eq(schema.conversations.workspaceId, wsId))
        .orderBy(desc(schema.conversations.startedAt))
        .limit(PAGE_SIZE + 1);
      const hasMore = rows.length > PAGE_SIZE;
      return {
        rows: (hasMore ? rows.slice(0, PAGE_SIZE) : rows).map((r) => ({
          ...r,
          startedAt: r.startedAt.toISOString(),
          takenOverAt: r.takenOverAt ? r.takenOverAt.toISOString() : null,
        })),
        hasMore,
        nextOffset: hasMore ? PAGE_SIZE : null,
      };
    }),
  ]);

  return (
    <ConversationsClient
      agents={agents}
      labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
      initialData={firstPage}
    />
  );
}
