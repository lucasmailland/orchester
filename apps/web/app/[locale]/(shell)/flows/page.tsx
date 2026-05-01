import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspace } from "@/lib/workspace";
import { FlowsListClient } from "./FlowsListClient";

export default async function FlowsPage() {
  const ws = await getCurrentWorkspace();
  if (!ws) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  return (
    <FlowsListClient
      flows={rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        status: r.status,
        nodeCount: (r.nodes as unknown[] | null)?.length ?? 0,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
      }))}
    />
  );
}
