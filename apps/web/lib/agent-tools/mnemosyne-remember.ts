// apps/web/lib/agent-tools/mnemosyne-remember.ts
//
// Tool handler for `mnemosyne_remember` (declared in the v1 Memory
// Protocol). When an agent calls this tool, the host:
//
//   1. Loads the agent's `AgentMemoryPolicy` (host-side helper).
//   2. Detects PII categories in the statement (regex layer).
//   3. Applies the policy's `write_scope_default` + `sensitive_categories`
//      via `applyPolicyToWrite` — sensitive-category facts get downgraded
//      to the agent partition regardless of the requested scope.
//   4. Persists via `createFactAsync` (the v1.1 async embed path).
//      Synchronous FTS makes the fact searchable immediately; the
//      batch worker fills in the embedding ~60s later.
//
// Failure semantics:
//   • Policy load NEVER throws (the loader returns DEFAULT on any
//     failure). So the only failures here are PII detect (pure) and
//     createFactAsync (DB / enqueue).
//   • PII detect throwing → degrade to "no categories" and continue.
//   • createFactAsync throwing → propagate; the tool result becomes
//     an error block in the agent's loop (already handled by the
//     `executeTool` try/catch in agent-runtime.ts).
//
// Optional `tx?: WsDb` follows the project-wide pattern: when the agent
// runtime is already inside a workspace transaction, threading tx keeps
// every DB op on the same connection so FORCE RLS sees the GUC.

import "server-only";
import {
  detectPII,
  applyPolicyToWrite,
  createFactAsync,
  withMnemoTx,
  type CreateFactAsyncInput,
} from "@orchester/mnemosyne";
import type { DbClient } from "@orchester/db";
import { getAgentMemoryPolicy } from "@/lib/policy/agent-memory";
import { enqueue, JOB_MNEMO_EMBED_FACT } from "@/lib/queue";
import { safeLogError } from "@/lib/safe-log";

type WsDb = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

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
  /** Caller confidence (0..1). Defaults to 0.7 — protocol-level safe default. */
  confidence?: number;
  /**
   * Optional explicit scope override. When unset, the policy's
   * `write_scope_default` is applied. Sensitive-category PII forces the
   * scope to 'global' + agent partition regardless of this value (see
   * `applyPolicyToWrite`).
   */
  scope?: "global" | "conversation" | "employee" | "team";
}

export interface MnemosyneRememberContext {
  workspaceId: string;
  agentId: string;
  /** Required when caller wants 'conversation' scope. */
  conversationId?: string;
  /** Forwarded to fact.actorId for per-actor isolation (v1.4). */
  employeeId?: string;
  /** Optional workspace tx — see file header. */
  tx?: WsDb;
}

export interface MnemosyneRememberResult {
  ok: true;
  factId: string;
  /** Final scope after policy + PII downgrade. May differ from request. */
  scope: string;
  /** Categories detected in the statement; useful for the agent's UI. */
  detectedPii: string[];
  /**
   * True when policy or PII downgraded the scope. The agent's render
   * layer may want to surface this to the user ("saved as private to
   * this agent because the fact contains an email address").
   */
  downgraded: boolean;
}

/**
 * Validate + normalize tool input. Returns a typed shape or throws —
 * the agent-runtime's executeTool wrapper catches the throw and sends
 * an error block back to the model.
 */
function normalizeInput(input: Record<string, unknown>): MnemosyneRememberInput {
  const kind = String(input.kind ?? "");
  if (!VALID_KINDS.includes(kind as FactKindLiteral)) {
    throw new Error(`mnemosyne_remember: invalid kind '${kind}'`);
  }
  const subject = String(input.subject ?? "").trim();
  if (!subject) throw new Error("mnemosyne_remember: subject required");
  const statement = String(input.statement ?? "").trim();
  if (!statement) throw new Error("mnemosyne_remember: statement required");

  const confRaw = input.confidence;
  let confidence: number | undefined;
  if (confRaw !== undefined) {
    const n = Number(confRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error("mnemosyne_remember: confidence must be in [0,1]");
    }
    confidence = n;
  }

  const scope = input.scope ? String(input.scope) : undefined;
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
  if (scope !== undefined) {
    out.scope = scope as NonNullable<MnemosyneRememberInput["scope"]>;
  }
  return out;
}

/**
 * Handler for `mnemosyne_remember`. Loads the agent policy, runs PII
 * detection on the statement, applies the policy's write rules, and
 * persists the fact via the async-embed path.
 */
export async function handleMnemosyneRemember(
  rawInput: Record<string, unknown>,
  ctx: MnemosyneRememberContext
): Promise<MnemosyneRememberResult> {
  if (!ctx.agentId) {
    throw new Error("mnemosyne_remember requires ctx.agentId");
  }

  const input = normalizeInput(rawInput);

  // ── Load policy (never throws — loader returns DEFAULT on failure)
  const policy = await getAgentMemoryPolicy({
    workspaceId: ctx.workspaceId,
    agentId: ctx.agentId,
    ...(ctx.tx ? { tx: ctx.tx } : {}),
  });

  // ── Detect PII categories (pure, regex-only). Defensive try/catch:
  // the regex layer doesn't throw on typical inputs, but adversarial
  // pathological strings (e.g., 1MB of nested unicode) can blow the
  // engine; we treat that as "no categories detected" rather than
  // crashing the save.
  let detected: string[] = [];
  try {
    const result = detectPII(input.statement);
    detected = result.categories.map((c) => String(c));
  } catch (e) {
    safeLogError("[mnemosyne_remember] detectPII threw:", e);
    detected = [];
  }

  // ── Translate the requested scope (or absent → policy default) into
  // a CreateFactInput-ready scope. The package helper does the actual
  // intent → storage translation; we just hand it a base input.
  const requestedScope = input.scope ?? "global";
  const baseInput: CreateFactAsyncInput = {
    workspaceId: ctx.workspaceId,
    agentId: ctx.agentId,
    scope: requestedScope,
    ...(requestedScope === "conversation" && ctx.conversationId
      ? { scopeRef: ctx.conversationId }
      : {}),
    kind: input.kind,
    subject: input.subject,
    statement: input.statement,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(ctx.employeeId ? { actorId: ctx.employeeId } : {}),
    // Critical: tx is supplied below at call time so the package
    // helper's chosen branch (with or without tx) is identical.
    tx: null as unknown as Parameters<typeof createFactAsync>[0]["tx"],
    // Enqueue callback — host owns pg-boss; mnemosyne stays pure. We
    // explicitly drop the unused jobId returned by enqueue: the
    // batch worker scans for unembedded facts as a backstop anyway.
    enqueueEmbed: async (name, data) => {
      await enqueue(name, data);
    },
  };

  const filteredInput = applyPolicyToWrite(policy, baseInput, detected);
  const downgraded = filteredInput.scope !== baseInput.scope;

  // ── Persist. Use the caller's tx if supplied, else open a fresh
  // mnemo-scoped tx (sets app.workspace_id GUC + downgrades role).
  const fact = ctx.tx
    ? await createFactAsync({ ...filteredInput, tx: ctx.tx as never })
    : await withMnemoTx(ctx.workspaceId, (tx) => createFactAsync({ ...filteredInput, tx }));

  // Provide the worker with a backup enqueue if the inline enqueue
  // failed silently (createFactAsync swallows enqueue errors today —
  // the worker's periodic sweep covers the gap, but we attempt an
  // explicit enqueue here too for redundancy). Defensive: if the
  // enqueue itself fails, the worker's backstop still picks it up.
  try {
    await enqueue(JOB_MNEMO_EMBED_FACT, {
      factId: fact.id,
      workspaceId: ctx.workspaceId,
      statement: fact.statement,
    });
  } catch (e) {
    safeLogError("[mnemosyne_remember] backup enqueue failed:", e);
  }

  return {
    ok: true,
    factId: fact.id,
    scope: String(filteredInput.scope ?? "global"),
    detectedPii: detected,
    downgraded,
  };
}
