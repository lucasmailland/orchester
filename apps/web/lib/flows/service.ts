import "server-only";
import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { schema } from "@orchester/db";
import { logAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/billing/quotas";
import { withRepo, type FlowRepo } from "./flow-repo";
import { normalizeFlowNodes, normalizeFlowEdges } from "./normalize";
import { validateStoredFlow, hasErrors } from "./validate-stored";
import type { ValidationIssue } from "./validate";

/**
 * Workspace-scoped flow operations shared by the session routes and the MCP
 * tools. Every read and write is bound to `actor.workspaceId`: a flow, run or
 * webhook of another workspace is reported as not found.
 */

export type Flow = typeof schema.flows.$inferSelect;
export type FlowRun = typeof schema.flowRuns.$inferSelect;
export type FlowRunStep = typeof schema.flowRunSteps.$inferSelect;
export type FlowWebhook = typeof schema.flowWebhooks.$inferSelect;
export interface RedactedFlowWebhook {
  id: string;
  flowId: string;
  hmac: boolean;
  createdAt: Date;
}

export type FlowActor =
  | { kind: "user"; workspaceId: string; userId: string }
  | { kind: "apiKey"; workspaceId: string; keyId: string };

export class FlowServiceError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "quota" | "template_not_found" | "internal",
    message: string,
    readonly issues?: ValidationIssue[]
  ) {
    super(message);
    this.name = "FlowServiceError";
  }
}

/** Optional fields may be passed as `undefined` (zod output); absent and undefined mean "unchanged". */
export interface FlowInput {
  name?: string | undefined;
  description?: string | null | undefined;
  spec?: string | null | undefined;
  nodes?: unknown[] | undefined;
  edges?: unknown[] | undefined;
  variables?: Record<string, unknown> | undefined;
  status?: "draft" | "active" | "paused" | undefined;
  trigger?: "manual" | "webhook" | "schedule" | "conversation" | undefined;
  triggerConfig?: Record<string, unknown> | undefined;
  enabled?: boolean | undefined;
  templateId?: string | undefined;
}

const notFound = (what: string) => new FlowServiceError("not_found", `${what} not found`);

async function requireFlow(repo: FlowRepo, actor: FlowActor, id: string): Promise<Flow> {
  const flow = await repo.findFlow(id, actor.workspaceId);
  if (!flow) throw notFound("Flow");
  return flow;
}

/**
 * API-key writes are audited inside the same transaction: the change and its
 * audit entry commit together, and the write fails if the entry cannot be
 * stored.
 */
async function auditApiKey(repo: FlowRepo, actor: FlowActor, action: string, flow: Flow) {
  if (actor.kind !== "apiKey") return;
  await repo.audit(actor.workspaceId, {
    action,
    actorUserId: null,
    actorKind: "api_key",
    targetType: "flow",
    targetId: flow.id,
    meta: { apiKeyId: actor.keyId, after: { name: flow.name } },
  });
}

/**
 * User writes keep the existing best-effort audit after the commit: `logAudit`
 * swallows its own failures, so a broken audit never fails an editor save.
 */
async function auditUser(actor: FlowActor, action: string, flow: Flow) {
  if (actor.kind !== "user") return;
  await logAudit({
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action,
    resource: "flow",
    resourceId: flow.id,
    after: { name: flow.name },
  });
}

/** Strict callers (MCP) cannot store a graph with errors; the editor may save drafts. */
function checkGraph(
  nodes: unknown[],
  edges: unknown[],
  spec: string | null,
  strict: boolean
): ValidationIssue[] {
  if (!strict) return [];
  const issues = validateStoredFlow(nodes, edges, { spec });
  if (hasErrors(issues)) {
    throw new FlowServiceError(
      "invalid",
      "The flow has errors",
      issues.filter((i) => i.level === "error")
    );
  }
  return issues;
}

export function listFlows(actor: FlowActor): Promise<Flow[]> {
  return withRepo(actor, (repo) => repo.listFlows(actor.workspaceId));
}

export function getFlow(actor: FlowActor, flowId: string): Promise<Flow> {
  return withRepo(actor, (repo) => requireFlow(repo, actor, flowId));
}

export async function createFlow(
  actor: FlowActor,
  input: FlowInput & { name: string },
  { strict = false }: { strict?: boolean } = {}
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const quota = await checkQuota(actor.workspaceId, "flows");
  if (!quota.allowed) {
    throw new FlowServiceError("quota", quota.reason ?? "Flow quota exceeded for your plan");
  }
  const result = await withRepo(actor, async (repo) => {
    let nodes: unknown[] = input.nodes ?? [];
    let edges: unknown[] = input.edges ?? [];
    let variables: Record<string, unknown> = input.variables ?? {};
    if (input.templateId) {
      // Server-stored templates win over an inline seed, so a saved template
      // can never be silently overridden by a stale client payload.
      const t = await repo.findTemplate(input.templateId, actor.workspaceId);
      if (!t) throw new FlowServiceError("template_not_found", "Template not found");
      nodes = (t.nodes as unknown[]) ?? [];
      edges = (t.edges as unknown[]) ?? [];
      variables = (t.variables as Record<string, unknown>) ?? {};
    }
    const spec = input.spec ?? null;
    const warnings = checkGraph(nodes, edges, spec, strict);
    // Whatever the source, store only a graph the editor can open.
    const flow = await repo.insertFlow({
      id: createId(),
      workspaceId: actor.workspaceId,
      name: input.name.trim(),
      description: input.description ?? null,
      spec,
      nodes: normalizeFlowNodes(nodes) as never,
      edges: normalizeFlowEdges(edges) as never,
      variables,
    });
    if (!flow) throw new FlowServiceError("internal", "Insert failed");
    await auditApiKey(repo, actor, "flow.create", flow);
    return { flow, warnings };
  });
  await auditUser(actor, "flow.create", result.flow);
  return result;
}

export async function updateFlow(
  actor: FlowActor,
  flowId: string,
  input: FlowInput,
  { strict = false }: { strict?: boolean } = {}
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const result = await withRepo(actor, async (repo) => {
    let warnings: ValidationIssue[] = [];
    if (strict) {
      const current = await requireFlow(repo, actor, flowId);
      warnings = checkGraph(
        input.nodes ?? (current.nodes as unknown[]) ?? [],
        input.edges ?? (current.edges as unknown[]) ?? [],
        input.spec !== undefined ? input.spec : current.spec,
        strict
      );
    }
    const flow = await repo.updateFlow(flowId, actor.workspaceId, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.spec !== undefined && { spec: input.spec }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.trigger !== undefined && { trigger: input.trigger }),
      ...(input.triggerConfig !== undefined && { triggerConfig: input.triggerConfig }),
      ...(input.nodes !== undefined && { nodes: normalizeFlowNodes(input.nodes) as never }),
      ...(input.edges !== undefined && { edges: normalizeFlowEdges(input.edges) as never }),
      ...(input.variables !== undefined && { variables: input.variables }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: new Date(),
    });
    if (!flow) throw notFound("Flow");
    await auditApiKey(repo, actor, "flow.update", flow);
    return { flow, warnings };
  });
  await auditUser(actor, "flow.update", result.flow);
  return result;
}

export function validateFlowById(actor: FlowActor, flowId: string): Promise<ValidationIssue[]> {
  return withRepo(actor, async (repo) => {
    const flow = await requireFlow(repo, actor, flowId);
    return validateStoredFlow(flow.nodes, flow.edges, { spec: flow.spec });
  });
}

export function getFlowRun(
  actor: FlowActor,
  runId: string
): Promise<{ run: FlowRun; steps: FlowRunStep[] }> {
  return withRepo(actor, async (repo) => {
    const run = await repo.findRun(runId, actor.workspaceId);
    if (!run) throw notFound("Run");
    return { run, steps: await repo.listSteps(run.id) };
  });
}

export const FLOW_RUNS_DEFAULT_LIMIT = 20;
export const FLOW_RUNS_MAX_LIMIT = 100;

export function listFlowRuns(
  actor: FlowActor,
  flowId: string,
  limit = FLOW_RUNS_DEFAULT_LIMIT
): Promise<FlowRun[]> {
  const n = Math.min(
    FLOW_RUNS_MAX_LIMIT,
    Math.max(1, Math.trunc(Number(limit) || FLOW_RUNS_DEFAULT_LIMIT))
  );
  return withRepo(actor, async (repo) => {
    await requireFlow(repo, actor, flowId);
    return repo.listRuns(flowId, actor.workspaceId, n);
  });
}

export function createFlowWebhook(
  actor: FlowActor,
  flowId: string,
  opts: { hmac?: boolean }
): Promise<FlowWebhook> {
  return withRepo(actor, async (repo) => {
    await requireFlow(repo, actor, flowId);
    const hook = await repo.insertWebhook({
      id: createId(),
      flowId,
      workspaceId: actor.workspaceId,
      secret: crypto.randomBytes(24).toString("hex"),
      hmacKey: opts.hmac ? crypto.randomBytes(32).toString("hex") : null,
    });
    if (!hook) throw new FlowServiceError("internal", "Insert failed");
    return hook;
  });
}

export function listFlowWebhooks(
  actor: FlowActor,
  flowId: string,
  { redact = false }: { redact?: boolean } = {}
): Promise<Array<FlowWebhook | RedactedFlowWebhook>> {
  return withRepo(actor, async (repo) => {
    await requireFlow(repo, actor, flowId);
    const rows = await repo.listWebhooks(flowId, actor.workspaceId);
    if (!redact) return rows;
    return rows.map((w) => ({
      id: w.id,
      flowId: w.flowId,
      hmac: Boolean(w.hmacKey),
      createdAt: w.createdAt,
    }));
  });
}

/** Public URL of a flow webhook; a configured base URL is required. */
export function webhookUrl(secret: string): string {
  const base = (process.env["NEXT_PUBLIC_APP_URL"] ?? process.env["BETTER_AUTH_URL"] ?? "").replace(
    /\/+$/,
    ""
  );
  if (!base) throw new Error("Configure NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL for webhook URLs");
  return `${base}/api/webhooks/${secret}`;
}

/** Maps a FlowServiceError to the HTTP response the session routes return. */
export function serviceErrorResponse(e: unknown): Response {
  if (e instanceof FlowServiceError) {
    const status = {
      not_found: 404,
      invalid: 422,
      quota: 402,
      template_not_found: 404,
      internal: 500,
    }[e.code];
    const error = e.code === "not_found" ? "Not found" : e.message;
    return Response.json({ error, ...(e.issues ? { issues: e.issues } : {}) }, { status });
  }
  throw e;
}
