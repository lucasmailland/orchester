import "server-only";
import { schema } from "@orchester/db";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getTeams } from "@/lib/db-queries";
import {
  AdminError,
  auditAdmin,
  confirmName,
  withAdminTx,
  type AdminActor,
  type AdminDb,
} from "@/lib/workspace-admin";

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional(),
  avatarColor: z.string().optional(),
});
export const updateTeamSchema = createTeamSchema
  .partial()
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    "At least one field is required"
  );

export function listTeams(actor: AdminActor) {
  return withAdminTx(actor, async (tx) =>
    (await getTeams(actor.workspaceId, tx)).map(
      ({ id, name, description, avatarColor, agentCount }) => ({
        id,
        name,
        description,
        avatarColor,
        agentCount,
      })
    )
  );
}

export async function requireTeam(tx: AdminDb, workspaceId: string, id: string) {
  const [team] = await tx
    .select()
    .from(schema.teams)
    .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, workspaceId)))
    .limit(1);
  if (!team) throw new AdminError("Team not found", 404);
  return team;
}

export function createTeam(actor: AdminActor, input: z.input<typeof createTeamSchema>) {
  const data = createTeamSchema.parse(input);
  return withAdminTx(actor, async (tx) => {
    const [team] = await tx
      .insert(schema.teams)
      .values({
        id: createId(),
        workspaceId: actor.workspaceId,
        name: data.name,
        description: data.description?.trim() || null,
        avatarColor: data.avatarColor || "#7C3AED",
      })
      .returning();
    await auditAdmin(tx, actor, "team", "create", team!);
    return team!;
  });
}

export function updateTeam(actor: AdminActor, id: string, input: z.input<typeof updateTeamSchema>) {
  const data = updateTeamSchema.parse(input);
  return withAdminTx(actor, async (tx) => {
    const [team] = await tx
      .update(schema.teams)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description.trim() || null }),
        ...(data.avatarColor !== undefined && { avatarColor: data.avatarColor || "#7C3AED" }),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, actor.workspaceId)))
      .returning();
    if (!team) throw new AdminError("Team not found", 404);
    await auditAdmin(tx, actor, "team", "update", team);
    return team;
  });
}

export function deleteTeam(actor: AdminActor, id: string, confirm?: unknown) {
  return withAdminTx(actor, async (tx) => {
    const team = await requireTeam(tx, actor.workspaceId, id);
    if (actor.kind === "apiKey") confirmName(confirm, team.name);
    const [agents, channels] = await Promise.all([
      tx
        .select({ id: schema.agents.id, name: schema.agents.name })
        .from(schema.agents)
        .where(and(eq(schema.agents.workspaceId, actor.workspaceId), eq(schema.agents.teamId, id))),
      tx
        .select({ id: schema.channels.id, name: schema.channels.name })
        .from(schema.channels)
        .where(
          and(eq(schema.channels.workspaceId, actor.workspaceId), eq(schema.channels.teamId, id))
        ),
    ]);
    if (agents.length || channels.length)
      throw new AdminError(
        [
          ...(agents.length ? [`Agents: ${agents.map((a) => a.name).join(", ")}.`] : []),
          ...(channels.length ? [`Channels: ${channels.map((c) => c.name).join(", ")}.`] : []),
        ].join(" ")
      );
    const [deleted] = await tx
      .delete(schema.teams)
      .where(
        and(
          eq(schema.teams.id, id),
          eq(schema.teams.workspaceId, actor.workspaceId),
          eq(schema.teams.name, team.name)
        )
      )
      .returning({ id: schema.teams.id });
    if (!deleted) throw new AdminError("Team not found", 404);
    await auditAdmin(tx, actor, "team", "delete", team);
    return { ok: true };
  });
}
