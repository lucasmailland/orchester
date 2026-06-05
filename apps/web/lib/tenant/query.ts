// apps/web/lib/tenant/query.ts
//
// Safe-by-default query factory. Every query is pre-filtered by
// workspaceId. Eliminates the chance of forgetting the filter in
// application code. RLS still acts as the second barrier (defense in
// depth).
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §6
// Plan reference: Task A.23.
//
// Callers should NEVER pass `workspaceId` in create/update payloads —
// it's stamped automatically from the resolved tenant context. Insert /
// update payload types use `Omit<..., "workspaceId">` to encode that
// invariant at the type level.
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { TenantContext } from "./types";

type AgentInsert = Omit<typeof schema.agents.$inferInsert, "workspaceId">;
type AgentUpdate = Partial<Omit<typeof schema.agents.$inferInsert, "workspaceId" | "id">>;

export function tenantQuery(ctx: TenantContext) {
  const ws = ctx.workspace.id;
  const db = getDb();

  return {
    agents: {
      list: () => db.select().from(schema.agents).where(eq(schema.agents.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.agents)
          .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws)))
          .limit(1),
      create: (data: AgentInsert) =>
        db
          .insert(schema.agents)
          .values({ ...data, workspaceId: ws })
          .returning(),
      update: (id: string, data: AgentUpdate) =>
        db
          .update(schema.agents)
          .set(data)
          .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws)))
          .returning(),
      delete: (id: string) =>
        db
          .delete(schema.agents)
          .where(and(eq(schema.agents.id, id), eq(schema.agents.workspaceId, ws))),
    },
    teams: {
      list: () => db.select().from(schema.teams).where(eq(schema.teams.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.teams)
          .where(and(eq(schema.teams.id, id), eq(schema.teams.workspaceId, ws)))
          .limit(1),
    },
    employees: {
      list: () => db.select().from(schema.employees).where(eq(schema.employees.workspaceId, ws)),
      byId: (id: string) =>
        db
          .select()
          .from(schema.employees)
          .where(and(eq(schema.employees.id, id), eq(schema.employees.workspaceId, ws)))
          .limit(1),
    },
    // Pattern continues for: channels, conversations, flows,
    // workspaceIntegrations, knowledgeBases, knowledgeDocs,
    // knowledgeChunks, agentMemories, aiProviders, outboundWebhooks,
    // apiKeys, etc. Add as endpoints adopt this pattern in later tasks.
  };
}
