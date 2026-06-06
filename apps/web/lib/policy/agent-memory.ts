// apps/web/lib/policy/agent-memory.ts
//
// Host-side loader for an agent's `AgentMemoryPolicy`. The policy lives
// on `agent.memory_policy` (jsonb, migration 0036).
//
// Phase 3: the policy shape used to come from @mnemosyne/core's
// `parseAgentMemoryPolicy` + `DEFAULT_AGENT_MEMORY_POLICY`. After the
// service-extraction cut-over, mnemosyne doesn't know about orchester's
// agents — the policy is purely a host-side concept (it governs how an
// orchester agent's recall and write paths interact with mnemosyne).
// We define + validate it inline here with zod.
//
// Failure semantics:
//   • agent row missing                       → DEFAULT_AGENT_MEMORY_POLICY
//   • `memory_policy` column null             → DEFAULT_AGENT_MEMORY_POLICY
//   • column shape invalid (zod parse fails)  → DEFAULT_AGENT_MEMORY_POLICY + log
//   • db query throws                         → DEFAULT_AGENT_MEMORY_POLICY + log
//
// The contract is "never crash the turn because of policy load" — the
// recall + write paths in `agent-runtime.ts` rely on this never throwing.

import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbClient } from "@orchester/db";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Canonical schema for the per-agent memory policy. Mirrors the SQL
 * DEFAULT installed by migration 0036 and any later additions.
 *
 *   write_scope_default — where recall-shaped writes land by default
 *     when the caller doesn't specify a scope.
 *   read_scopes — which scopes the recall path will draw from.
 *   sensitive_categories — PII categories that should NEVER be
 *     persisted at the requested write scope; the write path
 *     downgrades them to a private agent partition instead.
 */
export const AgentMemoryPolicySchema = z.object({
  write_scope_default: z.enum(["workspace", "agent", "conversation"]).default("workspace"),
  read_scopes: z.array(z.enum(["workspace", "agent", "conversation"])).default(["workspace"]),
  sensitive_categories: z.array(z.string()).default([]),
});

export type AgentMemoryPolicy = z.infer<typeof AgentMemoryPolicySchema>;

/** Canonical default. Conservative: writes land workspace-wide, reads
 *  from workspace only, no special PII handling. */
export const DEFAULT_AGENT_MEMORY_POLICY: AgentMemoryPolicy = {
  write_scope_default: "workspace",
  read_scopes: ["workspace"],
  sensitive_categories: [],
};

/**
 * Pure validator — parses unknown jsonb and returns the canonical
 * shape, or throws on shape mismatch (caller handles the throw).
 */
export function parseAgentMemoryPolicy(raw: unknown): AgentMemoryPolicy {
  return AgentMemoryPolicySchema.parse(raw);
}

export interface GetAgentMemoryPolicyInput {
  workspaceId: string;
  agentId: string;
  tx?: WsDb;
}

/**
 * Load the agent's memory policy from `agent.memory_policy`. Falls back
 * to `DEFAULT_AGENT_MEMORY_POLICY` if the row is missing, the column is
 * null/empty, or the stored shape fails validation.
 *
 * Never throws — recall/write paths can call it without a try/catch
 * and trust they always get a usable policy back.
 */
export async function getAgentMemoryPolicy(
  input: GetAgentMemoryPolicyInput
): Promise<AgentMemoryPolicy> {
  try {
    const db = input.tx ?? getDb();
    const rows = await db
      .select({ memoryPolicy: schema.agents.memoryPolicy })
      .from(schema.agents)
      .where(
        and(eq(schema.agents.id, input.agentId), eq(schema.agents.workspaceId, input.workspaceId))
      )
      .limit(1);

    const raw = rows[0]?.memoryPolicy;
    if (!raw) return DEFAULT_AGENT_MEMORY_POLICY;

    try {
      return parseAgentMemoryPolicy(raw);
    } catch (e) {
      safeLogError(`[agent-memory] policy validation failed for agent ${input.agentId}:`, e);
      return DEFAULT_AGENT_MEMORY_POLICY;
    }
  } catch (e) {
    safeLogError(`[agent-memory] failed to load policy for agent ${input.agentId}:`, e);
    return DEFAULT_AGENT_MEMORY_POLICY;
  }
}
