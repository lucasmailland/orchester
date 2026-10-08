import { getDb, schema } from "@orchester/db";
import { and, count, eq, ne } from "drizzle-orm";

export interface FlowDeleteCounts {
  runs: number;
  versions: number;
  webhooks: number;
  schedules: number;
}

export interface FlowDeleteContext {
  flow: { id: string; name: string; enabled: boolean };
  /** Agents in the workspace driven by this flow (`agent.flow_id`). */
  agents: Array<{ id: string; name: string }>;
  /** Every other flow in the workspace, with its graph, to look for references. */
  otherFlows: Array<{ id: string; name: string; nodes: unknown }>;
  counts: FlowDeleteCounts;
}

export interface FlowDeleteBlockers {
  enabled: boolean;
  agents: Array<{ id: string; name: string }>;
  flows: Array<{ id: string; name: string }>;
}

/**
 * Pure: what stands between the caller and deleting this flow. The nodes of
 * other flows are free-form JSON (a `flow_call` node stores the callee id in
 * its config), so a reference is any occurrence of the id in the serialized
 * graph; flow ids are random, so false positives are not a practical concern.
 */
export function computeBlockers(ctx: FlowDeleteContext): FlowDeleteBlockers {
  return {
    enabled: ctx.flow.enabled,
    agents: ctx.agents.map((a) => ({ id: a.id, name: a.name })),
    flows: ctx.otherFlows
      .filter((f) => JSON.stringify(f.nodes ?? []).includes(ctx.flow.id))
      .map((f) => ({ id: f.id, name: f.name })),
  };
}

export function hasBlockers(b: FlowDeleteBlockers): boolean {
  return b.enabled || b.agents.length > 0 || b.flows.length > 0;
}

/** Human message for the 409, in the order the user should fix things. */
export function blockersMessage(b: FlowDeleteBlockers): string {
  const parts: string[] = [];
  if (b.enabled) parts.push("The flow is enabled; pause it before deleting it.");
  if (b.agents.length > 0) {
    parts.push(`Agents driven by this flow: ${b.agents.map((a) => a.name).join(", ")}.`);
  }
  if (b.flows.length > 0) {
    parts.push(`Flows that call this flow: ${b.flows.map((f) => f.name).join(", ")}.`);
  }
  return parts.join(" ");
}

/** Null when the flow does not exist in this workspace. */
export async function loadFlowDeleteContext(
  workspaceId: string,
  flowId: string
): Promise<FlowDeleteContext | null> {
  const db = getDb();
  const flow = (
    await db
      .select({
        id: schema.flows.id,
        name: schema.flows.name,
        enabled: schema.flows.enabled,
      })
      .from(schema.flows)
      .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!flow) return null;

  const countOf = async (
    table:
      | typeof schema.flowRuns
      | typeof schema.flowVersions
      | typeof schema.flowWebhooks
      | typeof schema.flowSchedules
  ) =>
    (
      await db
        .select({ n: count() })
        .from(table)
        .where(and(eq(table.flowId, flowId), eq(table.workspaceId, workspaceId)))
    )[0]?.n ?? 0;

  const [agents, otherFlows, runs, versions, webhooks, schedules] = await Promise.all([
    db
      .select({ id: schema.agents.id, name: schema.agents.name })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.flowId, flowId))),
    db
      .select({ id: schema.flows.id, name: schema.flows.name, nodes: schema.flows.nodes })
      .from(schema.flows)
      .where(and(eq(schema.flows.workspaceId, workspaceId), ne(schema.flows.id, flowId))),
    countOf(schema.flowRuns),
    countOf(schema.flowVersions),
    countOf(schema.flowWebhooks),
    countOf(schema.flowSchedules),
  ]);

  return { flow, agents, otherFlows, counts: { runs, versions, webhooks, schedules } };
}
