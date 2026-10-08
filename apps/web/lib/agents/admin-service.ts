import "server-only";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { updateAgentSchema } from "./schemas";
import { mergeAgentConfig } from "./tool-call-cap";
import { agentDeleteBlockers, agentBlockersMessage } from "./delete-impact";
import { unknownKbIds, withAgentKbIds } from "./knowledge-bases";
import { requireTeam } from "@/lib/teams/service";
import {
  AdminError,
  auditAdmin,
  confirmName,
  withAdminTx,
  type AdminActor,
  type AdminDb,
} from "@/lib/workspace-admin";

export const agentAdminPatchSchema = updateAgentSchema
  .pick({
    name: true,
    role: true,
    systemPrompt: true,
    model: true,
    status: true,
    teamId: true,
    tools: true,
    knowledgeBaseIds: true,
    temperature: true,
    maxTokens: true,
    maxToolCalls: true,
  })
  .partial();

async function requireAgent(tx: AdminDb, workspaceId: string, id: string) {
  const [agent] = await tx
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw new AdminError("Agent not found", 404);
  return agent;
}

export function getAgent(actor: AdminActor, id: string) {
  return withAdminTx(actor, (tx) => requireAgent(tx, actor.workspaceId, id));
}

export async function updateAgent(actor: AdminActor, id: string, input: Record<string, unknown>) {
  const data = agentAdminPatchSchema.parse(input);
  if (data.tools !== undefined) {
    const { listAllTools } = await import("@/lib/tools");
    const known = new Set(listAllTools().map((tool) => tool.name));
    const unknown = data.tools.filter((name) => !known.has(name));
    if (unknown.length) throw new AdminError(`Unknown tools: ${unknown.join(", ")}`, 400);
  }
  return withAdminTx(actor, async (tx) => {
    const current = await requireAgent(tx, actor.workspaceId, id);
    if (data.teamId) await requireTeam(tx, actor.workspaceId, data.teamId);
    if (data.knowledgeBaseIds?.length) {
      const unknown = await unknownKbIds(actor.workspaceId, data.knowledgeBaseIds, tx);
      if (unknown.length)
        throw new AdminError(`Unknown knowledge bases: ${unknown.join(", ")}`, 400);
    }
    const { temperature, knowledgeBaseIds, maxToolCalls, ...fields } = data;
    // Merged, not replaced: `config` carries keys owned by several features, and
    // both may change in the same update.
    let nextConfig: unknown = current.config;
    if (knowledgeBaseIds !== undefined) nextConfig = withAgentKbIds(nextConfig, knowledgeBaseIds);
    if (maxToolCalls !== undefined) nextConfig = mergeAgentConfig(nextConfig, { maxToolCalls });
    const configChanged = knowledgeBaseIds !== undefined || maxToolCalls !== undefined;
    const [agent] = await tx
      .update(schema.agents)
      .set({
        ...fields,
        ...(data.systemPrompt !== undefined && { systemPrompt: data.systemPrompt.trim() }),
        ...(data.teamId !== undefined && { teamId: data.teamId || null }),
        ...(configChanged && { config: nextConfig as Record<string, unknown> }),
        ...(temperature !== undefined && { temperature: String(temperature) }),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, actor.workspaceId)))
      .returning();
    if (!agent) throw new AdminError("Agent not found", 404);
    await auditAdmin(tx, actor, "agent", "update", agent);
    return agent;
  });
}

export function deleteAgent(actor: AdminActor, id: string, confirm?: unknown) {
  return withAdminTx(actor, async (tx) => {
    const agent = await requireAgent(tx, actor.workspaceId, id);
    if (actor.kind === "apiKey") confirmName(confirm, agent.name);
    if (agent.status === "active")
      throw new AdminError("The agent is active; set it to draft or inactive before deleting it.");
    const message = agentBlockersMessage(await agentDeleteBlockers(tx, actor.workspaceId, id));
    if (message) throw new AdminError(`Agent is referenced. ${message}`);
    const [deleted] = await tx
      .delete(schema.agents)
      .where(
        and(
          eq(schema.agents.id, id),
          eq(schema.agents.workspaceId, actor.workspaceId),
          eq(schema.agents.name, agent.name),
          eq(schema.agents.status, agent.status)
        )
      )
      .returning({ id: schema.agents.id });
    if (!deleted) throw new AdminError("Agent not found", 404);
    // After the guarded delete, so a refused delete rolls this back too.
    // Memories written by the agent are its own data. agent_memory has no FK, so
    // they would otherwise outlive the agent with nobody able to read them.
    // Team-scoped rows use agentId "team:<id>" and are not touched.
    await tx
      .delete(schema.agentMemories)
      .where(
        and(
          eq(schema.agentMemories.workspaceId, actor.workspaceId),
          eq(schema.agentMemories.agentId, id)
        )
      );
    await auditAdmin(tx, actor, "agent", "delete", agent);
    return {
      ok: true,
      cascades: ["agentVersions", "agentEvals", "agentMemories"],
      detached: ["conversations"],
      retained: ["usageEvents"],
    };
  });
}
