import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, desc } from "drizzle-orm";

/**
 * Persistent agent memory. Three scopes:
 * - global       — facts true across all users (e.g. "company holiday is on July 9")
 * - employee     — facts about a specific employee/customer (e.g. "prefers English")
 * - conversation — short-lived, lives within a single conversation thread
 *
 * Stored as `data: jsonb { key: value }` keyed by (agent, scope, conversationId?, employeeId?).
 * One row per (agent + scope + scope-target) — upsert semantics.
 */

export type MemoryScope = "global" | "conversation" | "employee";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  data: Record<string, unknown>;
  conversationId: string | null;
  employeeId: string | null;
  updatedAt: Date;
}

export interface MemoryQuery {
  agentId: string;
  workspaceId: string;
  conversationId?: string | undefined;
  employeeId?: string | undefined;
}

/** Fetch all relevant memories for an agent in a given context. Cheap (≤3 indexed lookups). */
export async function getRelevantMemories(q: MemoryQuery): Promise<MemoryRecord[]> {
  const db = getDb();
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

  return results;
}

/** Upsert a value into the memory bag. Merges into existing data. */
export async function setMemory(
  q: MemoryQuery & { scope: MemoryScope; key: string; value: unknown }
): Promise<MemoryRecord> {
  const db = getDb();
  const existing = await findRow(q);
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
      agentId: q.agentId,
      workspaceId: q.workspaceId,
      conversationId: q.scope === "conversation" ? q.conversationId ?? null : null,
      employeeId: q.scope === "employee" ? q.employeeId ?? null : null,
      scope: q.scope,
      data: { [q.key]: q.value },
    })
    .returning();
  return toRecord(inserted[0]!);
}

/** Remove a single key from the bag, or the whole row if `key` is null. */
export async function removeMemory(
  q: MemoryQuery & { scope: MemoryScope; key?: string | null }
): Promise<void> {
  const db = getDb();
  const existing = await findRow(q);
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
export async function listMemoryRows(agentId: string, workspaceId: string): Promise<MemoryRecord[]> {
  const db = getDb();
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

async function findRow(q: MemoryQuery & { scope: MemoryScope }) {
  const db = getDb();
  const conds = [
    eq(schema.agentMemories.agentId, q.agentId),
    eq(schema.agentMemories.workspaceId, q.workspaceId),
    eq(schema.agentMemories.scope, q.scope),
  ];
  if (q.scope === "conversation" && q.conversationId) {
    conds.push(eq(schema.agentMemories.conversationId, q.conversationId));
  }
  if (q.scope === "employee" && q.employeeId) {
    conds.push(eq(schema.agentMemories.employeeId, q.employeeId));
  }
  const rows = await db.select().from(schema.agentMemories).where(and(...conds)).limit(1);
  return rows[0] ?? null;
}

function toRecord(row: typeof schema.agentMemories.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    data: (row.data ?? {}) as Record<string, unknown>,
    conversationId: row.conversationId ?? null,
    employeeId: row.employeeId ?? null,
    updatedAt: row.updatedAt,
  };
}
