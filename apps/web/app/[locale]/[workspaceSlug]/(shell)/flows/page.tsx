import { getDb, schema } from "@orchester/db";
import { eq, desc } from "drizzle-orm";
import { getCurrentWorkspaceBySlug } from "@/lib/workspace";
import { summarizeFlowNatureTransitive } from "@/lib/flows/node-nature";
import { computeFlowRelations } from "@/lib/flows/relations";
import { loadTriggerCounts } from "@/lib/flows/relations-load";
import { FlowsListClient } from "./FlowsListClient";

export default async function FlowsPage({
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
    .from(schema.flows)
    .where(eq(schema.flows.workspaceId, ws.workspace.id))
    .orderBy(desc(schema.flows.updatedAt));
  const graphs = rows.map((r) => ({
    id: r.id,
    nodes: ((r.nodes as unknown[] | null) ?? []).map((n) => {
      const x = n as { id: string; type: string; label?: string; config?: Record<string, unknown> };
      return { id: x.id, type: x.type, label: x.label, config: x.config };
    }),
  }));
  const relations = computeFlowRelations(rows, await loadTriggerCounts(ws.workspace.id));
  return (
    <FlowsListClient
      flows={rows.map((r) => {
        const nature = summarizeFlowNatureTransitive(r.id, graphs);
        return {
          id: r.id,
          name: r.name,
          description: r.description ?? null,
          status: r.status,
          kind: r.kind ?? "pipeline",
          nodeCount: (r.nodes as unknown[] | null)?.length ?? 0,
          lastRunAt: r.lastRunAt?.toISOString() ?? null,
          aiStepCount: nature.counts.ai,
          aiViaSubflow: nature.aiSubflowNodeIds.length > 0,
          relations: relations[r.id],
        };
      })}
    />
  );
}
