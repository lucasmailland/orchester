import "server-only";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import type { AdminDb } from "@/lib/workspace-admin";

/** Live references block deletion. Owned evals/versions cascade, the agent's own
 * memories are deleted with it (agent_memory has no FK, so they would otherwise
 * be orphaned), conversations lose their FK, and immutable usage events retain
 * their historical agent id. */
export async function agentDeleteBlockers(tx: AdminDb, workspaceId: string, agentId: string) {
  const [flows, channels, employees] = await Promise.all([
    tx
      .select({ id: schema.flows.id, name: schema.flows.name, nodes: schema.flows.nodes })
      .from(schema.flows)
      .where(eq(schema.flows.workspaceId, workspaceId)),
    tx
      .select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(
        and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.agentId, agentId))
      ),
    tx
      .select({
        id: schema.employees.id,
        name: schema.employees.name,
        assignedAgentIds: schema.employees.assignedAgentIds,
      })
      .from(schema.employees)
      .where(eq(schema.employees.workspaceId, workspaceId)),
  ]);
  return {
    flows: flows
      .filter(
        (f) =>
          Array.isArray(f.nodes) &&
          f.nodes.some((node) => {
            if (!node || typeof node !== "object") return false;
            const n = node as { type?: string; config?: { agentId?: unknown } };
            return n.type === "agent" && n.config?.agentId === agentId;
          })
      )
      .map(({ id, name }) => ({ id, name })),
    channels,
    employees: employees
      .filter((e) => e.assignedAgentIds?.includes(agentId))
      .map(({ id, name }) => ({ id, name })),
  };
}

export function agentBlockersMessage(blockers: Awaited<ReturnType<typeof agentDeleteBlockers>>) {
  return Object.entries(blockers)
    .filter(([, rows]) => rows.length)
    .map(([kind, rows]) => `${kind}: ${rows.map((r) => r.name).join(", ")}.`)
    .join(" ");
}
