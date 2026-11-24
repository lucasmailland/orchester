import { getDb, schema } from "@orchester/db";
import { and, eq, inArray } from "drizzle-orm";
import type { ToolContext } from "@/lib/tools";

/**
 * EXEC-005: which integrations (`run_integration`) and flows (`flow_call`) an
 * agent may reach. Stored in `agent.config` like the knowledge bases; a
 * missing or empty list means none. Calls without an agent (a flow
 * integration step, the MCP server) never reach these two tools and are not
 * checked.
 */
export const INTEGRATIONS_KEY = "allowedIntegrationIds";
export const FLOWS_KEY = "allowedFlowIds";

export interface AgentScope {
  integrationIds: string[];
  flowIds: string[];
}

/** A call to an integration or flow that is not assigned to the calling agent. */
export class ToolScopeError extends Error {
  readonly code = "tool_scope";
  constructor(message: string) {
    super(message);
    this.name = "ToolScopeError";
  }
}

function ids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

export function readAgentScope(config: unknown): AgentScope {
  const c = (config as Record<string, unknown> | null | undefined) ?? {};
  return { integrationIds: ids(c[INTEGRATIONS_KEY]), flowIds: ids(c[FLOWS_KEY]) };
}

/** Returns `config` with the given lists replaced, keeping every other key. */
export function withAgentScope(
  config: Record<string, unknown>,
  scope: Partial<AgentScope>
): Record<string, unknown> {
  const next = { ...(config ?? {}) };
  if (scope.integrationIds !== undefined) next[INTEGRATIONS_KEY] = ids(scope.integrationIds);
  if (scope.flowIds !== undefined) next[FLOWS_KEY] = ids(scope.flowIds);
  return next;
}

type Db = NonNullable<ToolContext["tx"]>;

async function scopeOf(ctx: Pick<ToolContext, "workspaceId" | "agentId" | "tx">) {
  const rows = await (ctx.tx ?? getDb())
    .select({ config: schema.agents.config })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, ctx.agentId!), eq(schema.agents.workspaceId, ctx.workspaceId)))
    .limit(1);
  return readAgentScope(rows[0]?.config);
}

/** The workspace's integration rows among `ids`, in that order. */
export async function scopedIntegrations(workspaceId: string, allowed: string[], tx?: Db) {
  if (!allowed.length) return [];
  const { listIntegrations } = await import("@/lib/integrations/store");
  const rows = await listIntegrations(workspaceId, tx);
  return allowed.flatMap((id) => rows.filter((r) => r.id === id));
}

/** The workspace's flows among `ids`, in that order. */
export async function scopedFlows(workspaceId: string, allowed: string[], tx?: Db) {
  if (!allowed.length) return [];
  const rows = await (tx ?? getDb())
    .select({ id: schema.flows.id, name: schema.flows.name })
    .from(schema.flows)
    .where(and(eq(schema.flows.workspaceId, workspaceId), inArray(schema.flows.id, allowed)));
  return allowed.flatMap((id) => rows.filter((r) => r.id === id));
}

/**
 * Throws unless `integrationRef` (a row id, or a connector type such as
 * `odoo`) resolves, the way the run does, to a row assigned to the agent.
 * A ref that does not resolve is refused too: nothing is run for it.
 */
export async function assertIntegrationInScope(
  ctx: Pick<ToolContext, "workspaceId" | "agentId" | "tx">,
  integrationRef: string
): Promise<void> {
  if (!ctx.agentId) return;
  const { integrationIds } = await scopeOf(ctx);
  const { listIntegrations } = await import("@/lib/integrations/store");
  const { resolveIntegrationRef } = await import("@/lib/integrations/resolve");
  const resolved = resolveIntegrationRef(
    await listIntegrations(ctx.workspaceId, ctx.tx),
    integrationRef
  );
  if (resolved.ok && integrationIds.includes(resolved.id)) return;
  throw new ToolScopeError(
    `Integration "${integrationRef}" is not assigned to this agent. Allowed integrationId values: ${integrationIds.join(", ") || "none"}.`
  );
}

export async function assertFlowInScope(
  ctx: Pick<ToolContext, "workspaceId" | "agentId" | "tx">,
  flowId: string
): Promise<void> {
  if (!ctx.agentId) return;
  const { flowIds } = await scopeOf(ctx);
  if (flowIds.includes(flowId)) return;
  throw new ToolScopeError(
    `Flow "${flowId}" is not assigned to this agent. Allowed flowId values: ${flowIds.join(", ") || "none"}.`
  );
}
