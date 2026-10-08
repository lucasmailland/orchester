import "server-only";
import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { schema } from "@orchester/db";
import { logAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/billing/quotas";
import { withRepo, type FlowRepo } from "./flow-repo";
import { normalizeFlowNodes, normalizeFlowEdges } from "./normalize";
import { validateStoredFlow, hasErrors } from "./validate-stored";
import { changesTheGraph, restorePatch } from "./versions";
import type { ValidationIssue } from "./validate";
import type { ExternalCaller, FlowKind } from "./kind";
import { storedActionIssues } from "./action-guard";
import {
  buildExtraction,
  extractionBlockMessage,
  extractionSpec,
  planExtraction,
  type ExtractionBlock,
  type ExtractionMeta,
  type ExtractionPlan,
} from "./extract";
import {
  canonicalGroups,
  flowGroupsSchema,
  groupIssues,
  normalizeFlowGroups,
  pruneFlowGroups,
  type FlowGroup,
  type FlowGroupIcon,
} from "./groups";

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
  enabled: boolean;
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
  kind?: FlowKind | undefined;
  externalCallers?: ExternalCaller[] | undefined;
  /** Step groups (presentation only). Absent means "unchanged" (pruned if steps go away). */
  groups?: FlowGroup[] | undefined;
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
  strict: boolean,
  contract: { kind: FlowKind; variables: unknown }
): ValidationIssue[] {
  if (!strict) return [];
  const issues = validateStoredFlow(nodes, edges, { spec, ...contract });
  if (hasErrors(issues)) {
    throw new FlowServiceError(
      "invalid",
      "The flow has errors",
      issues.filter((i) => i.level === "error")
    );
  }
  return issues;
}

const nodeIdsOf = (nodes: unknown): string[] => normalizeFlowNodes(nodes).map((n) => n.id);

/**
 * Groups name steps, so they are checked against the steps the write leaves in
 * place, for every caller: unlike graph errors, a group naming a missing step
 * is not a draft, it is a broken reference. Returns the canonical shape.
 */
function checkGroups(groups: unknown, nodes: unknown): FlowGroup[] {
  const parsed = flowGroupsSchema.safeParse(groups);
  if (!parsed.success) {
    throw new FlowServiceError(
      "invalid",
      "The step groups are invalid",
      parsed.error.issues.map((i) => ({
        level: "error" as const,
        message: `groups.${i.path.join(".")}: ${i.message}`,
      }))
    );
  }
  const canonical = canonicalGroups(parsed.data as FlowGroup[]);
  const issues = groupIssues(canonical, nodeIdsOf(nodes));
  if (issues.length > 0) {
    throw new FlowServiceError("invalid", "The step groups are invalid", issues);
  }
  return canonical;
}

/**
 * The groups a write stores: the ones sent, validated; or, when only the steps
 * change, the stored ones minus the steps that are gone. Undefined when the
 * stored value stays as it is.
 */
function groupsForUpdate(current: Flow, input: FlowInput): FlowGroup[] | undefined {
  const nodes = input.nodes ?? current.nodes;
  if (input.groups !== undefined) return checkGroups(input.groups, nodes);
  if (input.nodes === undefined) return undefined;
  const pruned = pruneFlowGroups(normalizeFlowGroups(current.groups), nodeIdsOf(nodes));
  return JSON.stringify(pruned) === JSON.stringify(current.groups ?? []) ? undefined : pruned;
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
    const kind = input.kind ?? "pipeline";
    const warnings = checkGraph(nodes, edges, spec, strict, { kind, variables });
    const groups = checkGroups(input.groups ?? [], nodes);
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
      kind,
      externalCallers: input.externalCallers ?? [],
      groups,
    });
    if (!flow) throw new FlowServiceError("internal", "Insert failed");
    await auditApiKey(repo, actor, "flow.create", flow);
    return { flow, warnings };
  });
  await auditUser(actor, "flow.create", result.flow);
  return result;
}

/**
 * Quién hizo el cambio, para que el historial lo diga.
 *
 * Una lista de versiones que no dice quién las hizo obliga a cruzar la
 * auditoría por hora para responder "¿esto quién lo tocó?".
 */
function quienCambio(actor: FlowActor): string {
  if (actor.kind === "user") return `usuario ${actor.userId}`;
  return `api key ${actor.keyId}`;
}

export async function updateFlow(
  actor: FlowActor,
  flowId: string,
  input: FlowInput,
  { strict = false }: { strict?: boolean } = {}
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const result = await withRepo(actor, async (repo) => {
    let warnings: ValidationIssue[] = [];
    const current = await requireFlow(repo, actor, flowId);
    if (strict) {
      warnings = checkGraph(
        input.nodes ?? (current.nodes as unknown[]) ?? [],
        input.edges ?? (current.edges as unknown[]) ?? [],
        input.spec !== undefined ? input.spec : current.spec,
        strict,
        {
          kind: input.kind ?? current.kind ?? "pipeline",
          variables: input.variables ?? current.variables,
        }
      );
    }
    // Drafts stay editable, but an action that is (or becomes) enabled must satisfy its
    // contract whatever the caller's strictness: REST saves are non-strict, so this is the
    // only gate between a violating graph and the scheduler/webhooks. Restores come through
    // here too. Only checked when the change touches what the contract is about.
    if (
      input.kind !== undefined ||
      input.enabled !== undefined ||
      input.nodes !== undefined ||
      input.variables !== undefined
    ) {
      const finalKind = input.kind ?? current.kind ?? "pipeline";
      const finalEnabled = input.enabled ?? current.enabled;
      if (finalKind === "action" && finalEnabled === true) {
        const issues = storedActionIssues({
          kind: finalKind,
          nodes: input.nodes ?? current.nodes,
          variables: input.variables ?? current.variables,
        });
        if (issues.length > 0) {
          throw new FlowServiceError(
            "invalid",
            "An enabled action must satisfy the action contract; disable it or fix the graph",
            issues
          );
        }
      }
    }
    const groups = groupsForUpdate(current, input);
    // El estado anterior se guarda ANTES de pisarlo, en esta misma
    // transacción: si el update falla, no queda una versión fantasma de algo
    // que nunca llegó a cambiar.
    const nuevaVersion = changesTheGraph(current, {
      ...input,
      groups: input.groups !== undefined ? groups : undefined,
    })
      ? await repo.snapshotFlow(current, actor.workspaceId, quienCambio(actor))
      : undefined;
    const flow = await repo.updateFlow(flowId, actor.workspaceId, {
      ...(nuevaVersion !== undefined && { version: nuevaVersion }),
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
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.externalCallers !== undefined && { externalCallers: input.externalCallers }),
      ...(groups !== undefined && { groups }),
      updatedAt: new Date(),
    });
    if (!flow) throw notFound("Flow");
    await auditApiKey(repo, actor, "flow.update", flow);
    return { flow, warnings };
  });
  await auditUser(actor, "flow.update", result.flow);
  return result;
}

/** What to extract: a group, or steps; the new flow's name and looks default to the group's. */
export interface ExtractInput {
  groupId?: string | undefined;
  nodeIds?: string[] | undefined;
  name?: string | undefined;
  description?: string | undefined;
  icon?: FlowGroupIcon | undefined;
}

export type ExtractionPreview =
  | { ok: true; plan: ExtractionPlan }
  | { ok: false; blocks: ExtractionBlock[]; issues: ValidationIssue[] };

const blockIssues = (blocks: ExtractionBlock[]): ValidationIssue[] =>
  blocks.map((b) => ({
    level: "error" as const,
    ...(b.nodeId ? { nodeId: b.nodeId } : {}),
    message: extractionBlockMessage(b),
  }));

function planFor(flow: Flow, input: ExtractInput) {
  return planExtraction(
    flow,
    input.groupId !== undefined ? { groupId: input.groupId } : { nodeIds: input.nodeIds ?? [] }
  );
}

/** Plans an extraction on the stored flow without writing anything. */
export function previewExtraction(
  actor: FlowActor,
  flowId: string,
  input: ExtractInput
): Promise<ExtractionPreview> {
  return withRepo(actor, async (repo) => {
    const flow = await requireFlow(repo, actor, flowId);
    const planned = planFor(flow, input);
    return planned.ok
      ? planned
      : { ok: false, blocks: planned.blocks, issues: blockIssues(planned.blocks) };
  });
}

/**
 * Moves a block of steps into a new flow and calls it from where the block
 * was, in one transaction: the new flow is inserted, the parent's current
 * state is saved as a version (so the extraction can be restored), and the
 * parent is updated with one `subflow` step in place of the block.
 *
 * The new flow is created enabled and active: a disabled flow refuses calls
 * from other flows, so a disabled one would break every automated run of the
 * parent. Its kind is `action` when the block passes the action contract.
 */
export async function extractToFlow(
  actor: FlowActor,
  flowId: string,
  input: ExtractInput
): Promise<{ plan: ExtractionPlan; child: Flow; parent: Flow }> {
  const quota = await checkQuota(actor.workspaceId, "flows");
  if (!quota.allowed) {
    throw new FlowServiceError("quota", quota.reason ?? "Flow quota exceeded for your plan");
  }
  const result = await withRepo(actor, async (repo) => {
    const current = await requireFlow(repo, actor, flowId);
    const planned = planFor(current, input);
    if (!planned.ok) {
      throw new FlowServiceError(
        "invalid",
        "These steps cannot be extracted",
        blockIssues(planned.blocks)
      );
    }
    const { plan } = planned;
    const group = plan.sourceGroupId
      ? normalizeFlowGroups(current.groups).find((g) => g.id === plan.sourceGroupId)
      : undefined;
    const name = input.name?.trim() || group?.name;
    if (!name) {
      throw new FlowServiceError("invalid", "Give the new flow a name", [
        { level: "error", message: "name is required when extracting steps that are not a group" },
      ]);
    }
    const description = input.description?.trim() || group?.description;
    const icon = input.icon ?? group?.icon;
    const meta: ExtractionMeta = {
      name,
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
    };
    const childId = createId();
    const { parent, child } = buildExtraction(current, plan, meta, {
      childFlowId: childId,
      subflowNodeId: createId(),
    });
    const childFlow = await repo.insertFlow({
      id: childId,
      workspaceId: actor.workspaceId,
      name,
      description: description ?? null,
      spec: extractionSpec(plan, meta, current.name),
      nodes: child.nodes as never,
      edges: child.edges as never,
      variables: {},
      kind: plan.kind,
      externalCallers: [],
      groups: child.groups,
      enabled: true,
      status: "active",
    });
    if (!childFlow) throw new FlowServiceError("internal", "Insert failed");
    const version = await repo.snapshotFlow(current, actor.workspaceId, quienCambio(actor));
    const updated = await repo.updateFlow(flowId, actor.workspaceId, {
      version,
      nodes: parent.nodes as never,
      edges: parent.edges as never,
      groups: parent.groups,
      updatedAt: new Date(),
    });
    if (!updated) throw notFound("Flow");
    await auditApiKey(repo, actor, "flow.create", childFlow);
    await auditApiKey(repo, actor, "flow.update", updated);
    return { plan, child: childFlow, parent: updated };
  });
  await auditUser(actor, "flow.create", result.child);
  await auditUser(actor, "flow.update", result.parent);
  return result;
}

export function listFlowVersions(actor: FlowActor, flowId: string) {
  return withRepo(actor, async (repo) => {
    await requireFlow(repo, actor, flowId);
    return repo.listVersions(flowId, actor.workspaceId);
  });
}

/**
 * Vuelve el flow a una versión guardada.
 *
 * Restaurar es un cambio como cualquier otro, así que pasa por `updateFlow` y
 * por lo tanto deja su propia versión del estado que se está descartando. Sin
 * eso, deshacer una restauración equivocada sería imposible.
 */
export async function restoreFlowVersion(
  actor: FlowActor,
  flowId: string,
  versionId: string
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const version = await withRepo(actor, async (repo) => {
    await requireFlow(repo, actor, flowId);
    const found = await repo.findVersion(versionId, flowId, actor.workspaceId);
    if (!found) throw notFound("Flow version");
    return found;
  });
  return updateFlow(actor, flowId, restorePatch(version) as FlowInput);
}

export function validateFlowById(actor: FlowActor, flowId: string): Promise<ValidationIssue[]> {
  return withRepo(actor, async (repo) => {
    const flow = await requireFlow(repo, actor, flowId);
    return validateStoredFlow(flow.nodes, flow.edges, {
      spec: flow.spec,
      kind: flow.kind ?? "pipeline",
      variables: flow.variables,
    });
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
      enabled: w.enabled,
      createdAt: w.createdAt,
    }));
  });
}

const redactWebhook = (w: FlowWebhook): RedactedFlowWebhook => ({
  id: w.id,
  flowId: w.flowId,
  hmac: Boolean(w.hmacKey),
  enabled: w.enabled,
  createdAt: w.createdAt,
});

/** Webhook changes are audited in the same transaction, for API keys and users alike. */
async function auditWebhook(
  repo: FlowRepo,
  actor: FlowActor,
  action: "update" | "delete",
  hook: FlowWebhook,
  state: Record<string, unknown>
) {
  await repo.audit(actor.workspaceId, {
    action: `flow_webhook.${action}`,
    actorUserId: actor.kind === "user" ? actor.userId : null,
    actorKind: actor.kind === "apiKey" ? "api_key" : "user",
    targetType: "flow_webhook",
    targetId: hook.id,
    meta: {
      ...(actor.kind === "apiKey" ? { apiKeyId: actor.keyId } : {}),
      flowId: hook.flowId,
      [action === "delete" ? "before" : "after"]: state,
    },
  });
}

/** Pause or resume a webhook. The secret and HMAC key are never returned. */
export function updateFlowWebhook(
  actor: FlowActor,
  webhookId: string,
  patch: { enabled?: boolean | undefined }
): Promise<RedactedFlowWebhook> {
  return withRepo(actor, async (repo) => {
    const hook = await repo.findWebhook(webhookId, actor.workspaceId);
    if (!hook) throw notFound("Webhook");
    const changes: Partial<FlowWebhook> = {};
    if (patch.enabled !== undefined) changes.enabled = patch.enabled;
    if (Object.keys(changes).length === 0) return redactWebhook(hook);
    const updated = await repo.updateWebhook(webhookId, actor.workspaceId, changes);
    if (!updated) throw notFound("Webhook");
    await auditWebhook(repo, actor, "update", updated, { enabled: updated.enabled });
    return redactWebhook(updated);
  });
}

/** Remove a webhook for good. `confirm` must equal its id exactly. */
export function deleteFlowWebhook(
  actor: FlowActor,
  webhookId: string,
  confirm: unknown
): Promise<{ ok: true; id: string }> {
  return withRepo(actor, async (repo) => {
    const hook = await repo.findWebhook(webhookId, actor.workspaceId);
    if (!hook) throw notFound("Webhook");
    if (confirm !== hook.id) {
      throw new FlowServiceError("invalid", "confirm must equal the webhook id exactly.");
    }
    const deleted = await repo.deleteWebhook(webhookId, actor.workspaceId);
    if (!deleted) throw notFound("Webhook");
    await auditWebhook(repo, actor, "delete", hook, { enabled: hook.enabled });
    return { ok: true as const, id: hook.id };
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
