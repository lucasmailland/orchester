// apps/web/lib/policy/agent-memory.ts
//
// Host-side loader for an agent's `AgentMemoryPolicy`. The policy lives
// on `agent.memory_policy` (jsonb, migration 0036). Default values are
// canonical at the SQL layer AND in the package — `parseAgentMemoryPolicy`
// re-validates the row on read so a hand-edited / migrated workspace
// can't surface a malformed shape.
//
// Failure semantics:
//   • agent row missing                       → DEFAULT_AGENT_MEMORY_POLICY
//   • `memory_policy` column null             → DEFAULT_AGENT_MEMORY_POLICY
//   • column shape invalid (parseAgentMemoryPolicy throws)
//                                            → DEFAULT_AGENT_MEMORY_POLICY + log
//   • db query throws                         → DEFAULT_AGENT_MEMORY_POLICY + log
//
// The contract is "never crash the turn because of policy load" — the
// recall + write paths in `agent-runtime.ts` rely on this never throwing.
// Layer below (the package's `applyPolicyTo*` helpers) is pure, so
// returning the default is always safe.
//
// Optional `tx?: WsDb` follows the project-wide pattern (see
// `lib/billing/quotas.ts`). When the caller is already inside a
// workspace transaction (channels router, agent-runtime wrap), passing
// tx keeps the SELECT on the same connection so FORCE RLS sees
// `app.workspace_id` SET LOCAL.

import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DbClient } from "@orchester/db";
import {
  DEFAULT_AGENT_MEMORY_POLICY,
  parseAgentMemoryPolicy,
  type AgentMemoryPolicy,
} from "@/lib/dead-mnemo-stubs";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export interface GetAgentMemoryPolicyInput {
  workspaceId: string;
  agentId: string;
  tx?: WsDb;
}

/**
 * Load the agent's memory policy from `agent.memory_policy`. Falls back
 * to `DEFAULT_AGENT_MEMORY_POLICY` if the row is missing, the column is
 * null/empty (e.g., on workspaces that haven't migrated to v1.4 yet),
 * or the stored shape fails validation.
 *
 * The function never throws — recall/write paths can call it without a
 * try/catch and trust they always get a usable policy back.
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

    // Defensive: re-validate the stored shape. The SQL DEFAULT covers
    // the canonical case but a hand-edited row or a partially-applied
    // migration can surface as a malformed jsonb — the package's
    // `parseAgentMemoryPolicy` throws on shape errors, we catch + fall
    // back rather than propagate to the agent turn.
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
