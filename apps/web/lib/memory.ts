import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema, type DbClient } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";

/**
 * Persistent agent memory. Cuatro scopes:
 * - global       — facts true across all users del agente (e.g. "company holiday is on July 9")
 * - employee     — facts about a specific employee/customer (e.g. "prefers English")
 * - conversation — short-lived, lives within a single conversation thread
 * - team         — compartida por TODOS los agentes del mismo team (multi-agent
 *                  collaboration). Si Sofia escribe "Acme renovó plan a Pro",
 *                  Elena la lee porque están en el team "HR Benefits".
 *
 * Stored as `data: jsonb { key: value }` keyed by (agent, scope, conversation?, employee?, team?).
 * One row per (agent + scope + scope-target) — upsert semantics.
 *
 * Cuando `scope=="team"`, el `agentId` se ignora a fines lógicos: la fila se
 * persiste con `agentId = "team:<teamId>"` (string-prefijo) para mantener el
 * unique index actual. El `getRelevantMemories` lo busca por teamId resolviendo
 * el team del agente caller.
 *
 * Optional `tx?: WsDb` follows the project-wide pattern (see
 * `lib/billing/quotas.ts`): when callers are already inside a workspace
 * transaction (channels router, future flow engine wrap, agent runtime
 * tools), passing tx keeps every internal SELECT/UPDATE on the same
 * connection so FORCE RLS sees `app.workspace_id` SET LOCAL.
 */

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export type MemoryScope = "global" | "conversation" | "employee" | "team";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  data: Record<string, unknown>;
  conversationId: string | null;
  employeeId: string | null;
  teamId: string | null;
  updatedAt: Date;
}

export interface MemoryQuery {
  agentId: string;
  workspaceId: string;
  conversationId?: string | undefined;
  employeeId?: string | undefined;
}

/** Fetch all relevant memories for an agent in a given context. Cheap (≤3 indexed lookups). */
export async function getRelevantMemories(q: MemoryQuery, tx?: WsDb): Promise<MemoryRecord[]> {
  const db = tx ?? getDb();
  const results: MemoryRecord[] = [];

  // 1. Global memory — always included
  const global = await db
    .select()
    .from(schema.agentMemories)
    .where(
      and(
        eq(schema.agentMemories.agentId, q.agentId),
        eq(schema.agentMemories.workspaceId, q.workspaceId),
        eq(schema.agentMemories.scope, "global")
      )
    )
    .limit(1);
  for (const m of global) results.push(toRecord(m));

  // 2. Conversation memory (if conversation context available)
  if (q.conversationId) {
    const conv = await db
      .select()
      .from(schema.agentMemories)
      .where(
        and(
          eq(schema.agentMemories.agentId, q.agentId),
          eq(schema.agentMemories.workspaceId, q.workspaceId),
          eq(schema.agentMemories.scope, "conversation"),
          eq(schema.agentMemories.conversationId, q.conversationId)
        )
      )
      .limit(1);
    for (const m of conv) results.push(toRecord(m));
  }

  // 3. Employee memory (if employee context available)
  if (q.employeeId) {
    const emp = await db
      .select()
      .from(schema.agentMemories)
      .where(
        and(
          eq(schema.agentMemories.agentId, q.agentId),
          eq(schema.agentMemories.workspaceId, q.workspaceId),
          eq(schema.agentMemories.scope, "employee"),
          eq(schema.agentMemories.employeeId, q.employeeId)
        )
      )
      .limit(1);
    for (const m of emp) results.push(toRecord(m));
  }

  // 4. Team memory — compartida por todos los agentes del mismo team.
  const teamId = await resolveAgentTeam(q.agentId, q.workspaceId, tx);
  if (teamId) {
    const team = await db
      .select()
      .from(schema.agentMemories)
      .where(
        and(
          eq(schema.agentMemories.workspaceId, q.workspaceId),
          eq(schema.agentMemories.scope, "team"),
          eq(schema.agentMemories.teamId, teamId)
        )
      )
      .limit(1);
    for (const m of team) results.push(toRecord(m));
  }

  return results;
}

/** Upsert a value into the memory bag. Merges into existing data. */
export async function setMemory(
  q: MemoryQuery & { scope: MemoryScope; key: string; value: unknown },
  tx?: WsDb
): Promise<MemoryRecord> {
  const db = tx ?? getDb();
  // Para scope="team" resolvemos el teamId del agente caller. Si el caller no
  // tiene team, escribimos como global (failover). Avisar en el cliente.
  let teamId: string | null = null;
  if (q.scope === "team") {
    teamId = await resolveAgentTeam(q.agentId, q.workspaceId, tx);
    if (!teamId) {
      throw new Error("Agent has no team assigned — cannot write team-scoped memory");
    }
  }
  const existing = await findRow({ ...q, teamId }, tx);
  if (existing) {
    const merged = { ...(existing.data ?? {}), [q.key]: q.value };
    const updated = await db
      .update(schema.agentMemories)
      .set({ data: merged, updatedAt: new Date() })
      .where(eq(schema.agentMemories.id, existing.id))
      .returning();
    return toRecord(updated[0]!);
  }
  const inserted = await db
    .insert(schema.agentMemories)
    .values({
      id: createId(),
      // Para team-scope, usamos un agentId-prefijo así no coliciona con global del agente.
      agentId: q.scope === "team" ? `team:${teamId}` : q.agentId,
      workspaceId: q.workspaceId,
      conversationId: q.scope === "conversation" ? (q.conversationId ?? null) : null,
      employeeId: q.scope === "employee" ? (q.employeeId ?? null) : null,
      teamId: q.scope === "team" ? teamId : null,
      scope: q.scope,
      data: { [q.key]: q.value },
    })
    .returning();
  return toRecord(inserted[0]!);
}

/** Remove a single key from the bag, or the whole row if `key` is null. */
export async function removeMemory(
  q: MemoryQuery & { scope: MemoryScope; key?: string | null },
  tx?: WsDb
): Promise<void> {
  const db = tx ?? getDb();
  let teamId: string | null = null;
  if (q.scope === "team") {
    teamId = await resolveAgentTeam(q.agentId, q.workspaceId, tx);
  }
  const existing = await findRow({ ...q, teamId }, tx);
  if (!existing) return;
  if (q.key == null) {
    await db.delete(schema.agentMemories).where(eq(schema.agentMemories.id, existing.id));
    return;
  }
  const data = { ...(existing.data ?? {}) };
  delete data[q.key];
  if (Object.keys(data).length === 0) {
    await db.delete(schema.agentMemories).where(eq(schema.agentMemories.id, existing.id));
  } else {
    await db
      .update(schema.agentMemories)
      .set({ data, updatedAt: new Date() })
      .where(eq(schema.agentMemories.id, existing.id));
  }
}

/** List all memory rows for an agent (admin/UI use). */
export async function listMemoryRows(
  agentId: string,
  workspaceId: string,
  tx?: WsDb
): Promise<MemoryRecord[]> {
  const db = tx ?? getDb();
  const rows = await db
    .select()
    .from(schema.agentMemories)
    .where(
      and(
        eq(schema.agentMemories.agentId, agentId),
        eq(schema.agentMemories.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(schema.agentMemories.updatedAt));
  return rows.map(toRecord);
}

/**
 * Format relevant memories as a Markdown block to splice into the system prompt.
 * Returns "" when there's nothing useful — zero-cost in that case.
 */
export function formatMemoriesAsPromptBlock(records: MemoryRecord[]): string {
  if (records.length === 0) return "";
  const sections: string[] = [];
  for (const r of records) {
    const entries = Object.entries(r.data ?? {});
    if (entries.length === 0) continue;
    const heading =
      r.scope === "global"
        ? "Things you always know"
        : r.scope === "conversation"
          ? "Things you remember from this conversation"
          : r.scope === "team"
            ? "Things shared with your team"
            : "Things you know about this user";
    const bullets = entries
      .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
    sections.push(`### ${heading}\n${bullets}`);
  }
  if (sections.length === 0) return "";
  return `\n\n---\n## Memory\n${sections.join("\n\n")}\n---\n`;
}

/* ───────────────── helpers ───────────────── */

async function findRow(q: MemoryQuery & { scope: MemoryScope; teamId?: string | null }, tx?: WsDb) {
  const db = tx ?? getDb();
  const conds = [
    eq(schema.agentMemories.workspaceId, q.workspaceId),
    eq(schema.agentMemories.scope, q.scope),
  ];
  if (q.scope === "team") {
    if (!q.teamId) return null;
    conds.push(eq(schema.agentMemories.teamId, q.teamId));
  } else {
    conds.push(eq(schema.agentMemories.agentId, q.agentId));
  }
  if (q.scope === "conversation" && q.conversationId) {
    conds.push(eq(schema.agentMemories.conversationId, q.conversationId));
  }
  if (q.scope === "employee" && q.employeeId) {
    conds.push(eq(schema.agentMemories.employeeId, q.employeeId));
  }
  const rows = await db
    .select()
    .from(schema.agentMemories)
    .where(and(...conds))
    .limit(1);
  return rows[0] ?? null;
}

function toRecord(row: typeof schema.agentMemories.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    data: (row.data ?? {}) as Record<string, unknown>,
    conversationId: row.conversationId ?? null,
    employeeId: row.employeeId ?? null,
    teamId: row.teamId ?? null,
    updatedAt: row.updatedAt,
  };
}

/**
 * Resuelve el teamId del agente caller. Si el agente no tiene team, devuelve null.
 * Usado por getRelevantMemories y setMemory cuando scope==="team".
 */
async function resolveAgentTeam(
  agentId: string,
  workspaceId: string,
  tx?: WsDb
): Promise<string | null> {
  const db = tx ?? getDb();
  const rows = await db
    .select({ teamId: schema.agents.teamId })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  return rows[0]?.teamId ?? null;
}
