// packages/mnemosyne/src/policy/index.ts
//
// Mnemosyne v1.4 — per-agent memory policy. Pure helpers that translate
// an `AgentMemoryPolicy` (stored on `agent.memory_policy`, migration
// 0036) into modifications of `SearchMnemoInput` / `CreateFactInput`.
//
// Policy semantics:
//   • `write_scope_default`     — what scope a NEW fact lands in if the
//     caller doesn't specify (or specifies a less-restrictive scope
//     than the policy permits). Allowed: 'workspace' | 'agent' |
//     'conversation'.
//   • `read_scopes`             — which scopes a recall call may TRAVERSE
//     when this agent is the requester. If a scope is absent here, the
//     read path filters it out.
//   • `sensitive_categories`    — PIICategory[] (from
//     `packages/mnemosyne/src/pii/patterns.ts`). When a fact's detected
//     PII intersects this list, the effective write scope is downgraded
//     to 'agent' regardless of `write_scope_default`. The list is the
//     PII categories the workspace considers private to the learning
//     agent.
//
// §0.1: package-clean — no `server-only`, no host imports.

import type { SearchMnemoInput } from "../recall/search";
import type { CreateFactInput, FactScope } from "../primitives/fact";

/**
 * Three policy scope values. Maps onto the four `FactScope` enum values
 * in the fact primitives — 'workspace' here is stored as 'global' on
 * the row, 'agent' is conceptually scoped to the agent_id column (and
 * keeps `scope='global'` at the DB layer; the partition is by
 * agent_id, not by FactScope), and 'conversation' uses FactScope's
 * 'conversation' value plus `scope_ref = conversationId`.
 *
 * The policy lives at a higher level than the storage enum — it
 * expresses the *intent* of where memory belongs, and `applyPolicyTo*`
 * translates that intent into the existing storage primitives without
 * needing a new column.
 */
export type PolicyScope = "workspace" | "agent" | "conversation";

export interface AgentMemoryPolicy {
  write_scope_default: PolicyScope;
  read_scopes: PolicyScope[];
  /** PII categories (PIICategory in the pii module) that downgrade the
   *  write scope to 'agent' when present in the fact. */
  sensitive_categories: string[];
}

/**
 * The safe default that matches the SQL default in migration 0036.
 * v1.3 behaviour preserved: facts are workspace-shared by default, the
 * agent can read both workspace and its own facts, no PII categories
 * are flagged sensitive.
 */
export const DEFAULT_AGENT_MEMORY_POLICY: AgentMemoryPolicy = {
  write_scope_default: "workspace",
  read_scopes: ["workspace", "agent"],
  sensitive_categories: [],
};

/**
 * Validate a policy object (e.g. from a PATCH request body) and return
 * a safely-typed AgentMemoryPolicy. Throws on shape errors. Pure — no
 * IO. The host route is responsible for catching+returning 400.
 */
export function parseAgentMemoryPolicy(raw: unknown): AgentMemoryPolicy {
  if (!raw || typeof raw !== "object") {
    throw new Error("memory_policy must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const ws = obj.write_scope_default;
  if (ws !== "workspace" && ws !== "agent" && ws !== "conversation") {
    throw new Error("write_scope_default must be 'workspace' | 'agent' | 'conversation'");
  }
  const rs = obj.read_scopes;
  if (!Array.isArray(rs) || rs.length === 0) {
    throw new Error("read_scopes must be a non-empty array");
  }
  const validScopes: PolicyScope[] = ["workspace", "agent", "conversation"];
  for (const s of rs) {
    if (!validScopes.includes(s as PolicyScope)) {
      throw new Error(`read_scopes contains invalid value: ${String(s)}`);
    }
  }
  const sens = obj.sensitive_categories ?? [];
  if (!Array.isArray(sens) || !sens.every((c) => typeof c === "string")) {
    throw new Error("sensitive_categories must be an array of strings");
  }
  return {
    write_scope_default: ws,
    read_scopes: Array.from(new Set(rs as PolicyScope[])),
    sensitive_categories: Array.from(new Set(sens as string[])),
  };
}

/**
 * Apply the policy's `read_scopes` to a base SearchMnemoInput.
 *
 * Translation rules:
 *  - If the caller already set `scope`/`scopeRef`, we DO NOT override
 *    them — the explicit caller wins. (Policy is a default, not a
 *    veto. v2.0 will add a hard-veto enum.)
 *  - Otherwise, when `read_scopes` is exactly `['workspace']`, we set
 *    `scope: 'global'` so the recall path filters out conversation /
 *    employee / team-scoped facts.
 *  - When `read_scopes` includes 'agent' AND `agentId` is set on the
 *    base input, the search will already partition by agent — no
 *    change needed (existing v1.0 recall filter already covers it).
 *  - When `read_scopes` is `['agent']` (just the agent's own facts),
 *    we don't have a single SQL filter for that today; the recall
 *    primitive lets `agentId` flow through but with `OR agent_id IS
 *    NULL` baked into its WHERE clause. Until we add a strict-agent
 *    mode (v2.0), we leave the base input unchanged and document the
 *    limitation in the test suite.
 *
 * The helper is intentionally conservative — the goal at v1.4 is to
 * give workspaces an opt-in lever without rewriting the recall SQL.
 * Tighter enforcement lands in v2.0 after we observe usage.
 */
export function applyPolicyToRecall(
  policy: AgentMemoryPolicy,
  baseInput: SearchMnemoInput
): SearchMnemoInput {
  // If the caller already set a scope explicitly, respect it.
  if (baseInput.scope !== undefined) return baseInput;

  // Workspace-only reads → restrict to global scope at the DB layer.
  if (policy.read_scopes.length === 1 && policy.read_scopes[0] === "workspace") {
    return { ...baseInput, scope: "global" };
  }

  return baseInput;
}

/**
 * Apply the policy's `write_scope_default` + `sensitive_categories` to
 * a base CreateFactInput. The detected PII categories are passed by
 * the caller (extraction pipeline runs detectPII before calling
 * createFact; we don't re-detect here so we don't double the cost).
 *
 * Rules:
 *  - Explicit `scope` on the base input wins (legacy callers).
 *  - If any `detectedCategories` intersects `sensitive_categories`,
 *    the effective scope is forced to a non-workspace storage scope
 *    so the fact stays private to the agent. We translate to scope=
 *    'global' + agentId set, which under v1.3 recall is partitioned
 *    by agent_id — effectively private. (No 'agent' enum value
 *    exists in FactScope; the agent_id column is the partition.)
 *  - Otherwise the policy default maps to:
 *      'workspace'    → scope='global', agentId untouched
 *      'agent'        → scope='global', agentId from input must be set
 *      'conversation' → scope='conversation', scopeRef must be set
 */
export function applyPolicyToWrite(
  policy: AgentMemoryPolicy,
  baseInput: CreateFactInput,
  detectedCategories: string[]
): CreateFactInput {
  // Explicit caller scope wins.
  if (baseInput.scope !== undefined && baseInput.scope !== "global") {
    return baseInput;
  }

  // Sensitive PII intersect → downgrade to agent partition.
  const sensitive = new Set(policy.sensitive_categories);
  const intersect = detectedCategories.some((c) => sensitive.has(c));
  if (intersect) {
    return {
      ...baseInput,
      // Stays in 'global' FactScope storage; agent_id column is the
      // partition. Caller is expected to pass `agentId` — without it
      // the fact would be visible workspace-wide (NULL agent_id reads
      // as "workspace-shared" in recall).
      scope: "global",
    };
  }

  // Apply default mapping. The translation is deliberately simple:
  // `applyPolicyToWrite` only restricts; it never widens the scope.
  switch (policy.write_scope_default) {
    case "workspace":
      return { ...baseInput, scope: "global" };
    case "agent":
      return { ...baseInput, scope: "global" };
    case "conversation":
      // Translate to FactScope's `conversation`. Caller MUST have
      // provided `scopeRef` (the conversationId); we don't synthesize
      // one — failing loudly is better than silently misattributing
      // the fact.
      return { ...baseInput, scope: "conversation" };
    default:
      return baseInput;
  }
}
