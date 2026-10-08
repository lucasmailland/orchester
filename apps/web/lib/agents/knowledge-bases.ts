import { getDb, schema, type DbClient } from "@orchester/db";
import { and, eq, inArray } from "drizzle-orm";

type Db = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Key inside `agent.config` that holds the knowledge bases the agent may search. */
export const KB_CONFIG_KEY = "knowledgeBaseIds";

/** Ids stored on an agent's config, ignoring anything that is not a string list. */
export function readAgentKbIds(config: unknown): string[] {
  const raw = (config as Record<string, unknown> | null | undefined)?.[KB_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** Returns `config` with the KB list replaced, keeping every other key. */
export function withAgentKbIds(config: unknown, ids: string[]): Record<string, unknown> {
  const base = { ...((config as Record<string, unknown> | null | undefined) ?? {}) };
  if (ids.length) base[KB_CONFIG_KEY] = [...new Set(ids)];
  else delete base[KB_CONFIG_KEY];
  return base;
}

/** The workspace's own knowledge bases among `ids`; foreign or stale ids are dropped. */
export async function listWorkspaceKbs(
  workspaceId: string,
  ids: string[],
  tx?: Db
): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const rows = await (tx ?? getDb())
    .select({ id: schema.knowledgeBases.id, name: schema.knowledgeBases.name })
    .from(schema.knowledgeBases)
    .where(
      and(
        eq(schema.knowledgeBases.workspaceId, workspaceId),
        inArray(schema.knowledgeBases.id, ids)
      )
    );
  const found = new Map(rows.map((r) => [r.id, r]));
  // Keep the configured order and never trust the query to have filtered.
  return ids.flatMap((id) => (found.has(id) ? [found.get(id)!] : []));
}

/** Ids that are not knowledge bases of the workspace (empty when all are valid). */
export async function unknownKbIds(workspaceId: string, ids: string[], tx?: Db): Promise<string[]> {
  const valid = new Set((await listWorkspaceKbs(workspaceId, ids, tx)).map((k) => k.id));
  return ids.filter((id) => !valid.has(id));
}

/** Knowledge bases an agent may search: its configured ids that exist in the workspace. */
export async function agentKbs(
  workspaceId: string,
  agentId: string,
  tx?: Db
): Promise<{ id: string; name: string }[]> {
  const rows = await (tx ?? getDb())
    .select({ config: schema.agents.config })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.workspaceId, workspaceId)))
    .limit(1);
  return listWorkspaceKbs(workspaceId, readAgentKbIds(rows[0]?.config), tx);
}
