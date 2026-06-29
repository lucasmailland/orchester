// apps/web/lib/agent-tools/mnemosyne-remember.ts
//
// Tool handler for `mnemosyne_remember` (declared in the v1 Memory
// Protocol). When an agent calls this tool, the host:
//
//   1. Loads the agent's `AgentMemoryPolicy` (host-side; lives in
//      orchester's `agent.memory_policy` jsonb).
//   2. Resolves the requested fact scope against the policy default
//      (no explicit scope → policy.write_scope_default).
//   3. POSTs the fact to @mnemosyne/server via the SDK's `remember()`.
//      This calls POST /memory/remember (v3 cognitive engine path) so
//      facts land in the mnemosyne schema and are visible to recall.
//
// NOTE: previously used `createFact()` which calls POST /v1/facts and
// writes to the v1 `public.mnemo_fact` table. The v3 recall cascade
// reads from `mnemosyne.mnemo_fact`, so those facts were invisible to
// recall. `remember()` writes to the right schema.
//
// Embedding strategy: facts are pre-embedded host-side using the workspace's
// configured AI provider (same path as recall.ts) and the vector is forwarded
// to the server. This means the mnemosyne server never needs its own LLM
// credentials — write and query embeddings are always in the same vector
// space, making recall immediately effective for newly stored facts.
// If host-side embedding fails (no provider / network error) we fall back
// to server-side embedding (which requires MNEMO_LLM_API_KEY on the server).
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
import { embed } from "@/lib/embeddings";
import { safeLogError } from "@/lib/safe-log";

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

  // v3 cognitive write path — lands in mnemosyne schema so v3 recall
  // can find it. Previously used createFact() → public.mnemo_fact (v1)
  // which the recall cascade cannot see.
  //
  // Pre-embed host-side so the stored vector is in the same space as
  // query vectors (both use the workspace's OpenAI text-embedding-3-small).
  // Falls back gracefully: if embedding fails the server still tries its
  // own embedder (requires MNEMO_LLM_API_KEY on the server).
  const DEFAULT_EMBED_MODEL = "text-embedding-3-small";
  let vector: number[] | undefined;
  try {
    const { vectors } = await embed(ctx.workspaceId, "openai", DEFAULT_EMBED_MODEL, [
      input.statement,
    ]);
    vector = vectors[0];
  } catch (e) {
    safeLogError("[mnemo/remember] host-side embedding skipped:", e);
  }

  const client = getMnemoClient();
  const result = await client.remember({
    statement: input.statement,
    kind: input.kind,
    subject: input.subject,
    scope,
    ...(scope === "conversation" && ctx.conversationId ? { scopeRef: ctx.conversationId } : {}),
    agentId: ctx.agentId,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    tags: [input.kind],
    ...(vector ? { vector } : {}),
  });

  return {
    ok: true,
    factId: result.id,
    scope,
    downgraded,
  };
}
