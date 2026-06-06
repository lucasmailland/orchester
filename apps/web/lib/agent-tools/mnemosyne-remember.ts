// apps/web/lib/agent-tools/mnemosyne-remember.ts
//
// Tool handler for `mnemosyne_remember` (declared in the v1 Memory
// Protocol). When an agent calls this tool, the host:
//
//   1. Loads the agent's `AgentMemoryPolicy` (host-side; lives in
//      orchester's `agent.memory_policy` jsonb).
//   2. Resolves the requested fact scope against the policy default
//      (no explicit scope → policy.write_scope_default).
//   3. POSTs the fact to @mnemosyne/server via the SDK's
//      `createFact`. The mnemosyne server handles poisoning detection,
//      embedding enqueue, dedup, and FTS lemmatization internally.
//
// Phase 3: the host-side PII detect + `applyPolicyToWrite` +
// `createFactAsync` path was retired. The SDK is the canonical write
// path and the mnemosyne server owns those concerns now.
//
// Failure semantics:
//   • Policy load NEVER throws (the loader returns DEFAULT on any
//     failure). So failures here are only SDK transport / 4xx-5xx.
//   • SDK throw → propagates; the tool result becomes an error block
//     in the agent's loop (already handled by the `executeTool`
//     try/catch in agent-runtime.ts).

import "server-only";
import { getMnemoClient } from "@/lib/mnemo/client";
import { getAgentMemoryPolicy } from "@/lib/policy/agent-memory";

const VALID_KINDS = [
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
] as const;
type FactKindLiteral = (typeof VALID_KINDS)[number];

export interface MnemosyneRememberInput {
  /** Discriminator from the protocol: preference / trait / event / … */
  kind: FactKindLiteral;
  /** Subject the statement is about ('user', 'workspace', employee name, …). */
  subject: string;
  /** Natural-language fact body. */
  statement: string;
  /** Caller confidence (0..1). Defaults to 0.7. */
  confidence?: number;
  /**
   * Optional explicit scope override. When unset, the policy's
   * `write_scope_default` is applied.
   */
  scope?: "global" | "conversation" | "employee" | "team";
}

export interface MnemosyneRememberContext {
  workspaceId: string;
  agentId: string;
  /** Required when caller wants 'conversation' scope. */
  conversationId?: string;
  /** Forwarded to fact.actorId for per-actor isolation. */
  employeeId?: string;
}

export interface MnemosyneRememberResult {
  ok: true;
  factId: string;
  /** Final scope after policy resolution. */
  scope: string;
  /** True when policy downgraded the requested scope. */
  downgraded: boolean;
}

/**
 * Validate + normalize tool input. Throws on shape errors — the
 * agent-runtime's executeTool wrapper catches the throw and sends an
 * error block back to the model.
 */
function normalizeInput(input: Record<string, unknown>): MnemosyneRememberInput {
  const kind = String(input["kind"] ?? "");
  if (!VALID_KINDS.includes(kind as FactKindLiteral)) {
    throw new Error(`mnemosyne_remember: invalid kind '${kind}'`);
  }
  const subject = String(input["subject"] ?? "").trim();
  if (!subject) throw new Error("mnemosyne_remember: subject required");
  const statement = String(input["statement"] ?? "").trim();
  if (!statement) throw new Error("mnemosyne_remember: statement required");

  const confRaw = input["confidence"];
  let confidence: number | undefined;
  if (confRaw !== undefined) {
    const n = Number(confRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error("mnemosyne_remember: confidence must be in [0,1]");
    }
    confidence = n;
  }

  const rawScope = input["scope"];
  const scope = rawScope ? String(rawScope) : undefined;
  if (
    scope !== undefined &&
    scope !== "global" &&
    scope !== "conversation" &&
    scope !== "employee" &&
    scope !== "team"
  ) {
    throw new Error(`mnemosyne_remember: invalid scope '${scope}'`);
  }

  const out: MnemosyneRememberInput = {
    kind: kind as FactKindLiteral,
    subject,
    statement,
  };
  if (confidence !== undefined) out.confidence = confidence;
  if (scope !== undefined) out.scope = scope as NonNullable<MnemosyneRememberInput["scope"]>;
  return out;
}

/**
 * Resolve the agent's `write_scope_default` (workspace/agent/conversation)
 * into the storage scope the SDK accepts (global/conversation/employee/team).
 * The mapping mirrors the legacy host-side `applyPolicyToWrite` helper —
 * "workspace default" → global, "agent default" → workspace-shared but
 * agent-tagged via the agentId on the fact, "conversation default" →
 * conversation scope with scopeRef when the conv id is known.
 */
function resolveScope(
  requested: MnemosyneRememberInput["scope"] | undefined,
  policyDefault: "workspace" | "agent" | "conversation",
  conversationId?: string
): { scope: NonNullable<MnemosyneRememberInput["scope"]>; downgraded: boolean } {
  if (requested) return { scope: requested, downgraded: false };
  if (policyDefault === "conversation" && conversationId) {
    return { scope: "conversation", downgraded: false };
  }
  if (policyDefault === "conversation") {
    // No conv id → degrade to global rather than producing an
    // orphan-scoped row the recall layer can't filter on.
    return { scope: "global", downgraded: true };
  }
  // "workspace" and "agent" both land on the global scope — the agent
  // tag is enforced via fact.agentId, not via the scope dimension.
  return { scope: "global", downgraded: false };
}

/**
 * Handler for `mnemosyne_remember`. Loads policy, resolves scope, and
 * POSTs the fact to mnemosyne via the SDK.
 */
export async function handleMnemosyneRemember(
  rawInput: Record<string, unknown>,
  ctx: MnemosyneRememberContext
): Promise<MnemosyneRememberResult> {
  if (!ctx.agentId) {
    throw new Error("mnemosyne_remember requires ctx.agentId");
  }

  const input = normalizeInput(rawInput);

  const policy = await getAgentMemoryPolicy({
    workspaceId: ctx.workspaceId,
    agentId: ctx.agentId,
  });

  const { scope, downgraded } = resolveScope(
    input.scope,
    policy.write_scope_default,
    ctx.conversationId
  );

  // SDK fact create. Mnemosyne server runs poisoning detection +
  // dedup + embedding enqueue internally; orchester just hands it the
  // statement plus attribution metadata.
  const client = getMnemoClient();
  const fact = await client.createFact({
    content: input.statement,
    attribution: {
      kind: input.kind,
      subject: input.subject,
      scope,
      ...(scope === "conversation" && ctx.conversationId ? { scopeRef: ctx.conversationId } : {}),
      agentId: ctx.agentId,
      ...(ctx.employeeId ? { actorId: ctx.employeeId } : {}),
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    },
    tags: [input.kind],
  });

  return {
    ok: true,
    factId: fact.id,
    scope,
    downgraded,
  };
}
