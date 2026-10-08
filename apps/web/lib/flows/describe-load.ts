import "server-only";
import { describeFlow, type FlowSheet } from "./describe";
import { normalizeFlowNodes } from "./normalize";
import type { FlowActor } from "./service";

/**
 * Loads a flow, its callers and its webhooks through the workspace-bound
 * service and returns its fact sheet. Used by the MCP tool and the REST route
 * so both answer the same thing.
 *
 * Effects are looked up per integration step and are never guessed: an action
 * that cannot be resolved (integration gone, disabled, ambiguous) stays
 * unknown. An action with a fixed effect is always known; one that decides its
 * effect from the input (`execute`, `request`) is known only when the keys that
 * decide it hold no template (see `describedActionEffect`).
 */
export async function loadFlowSheet(actor: FlowActor, flowId: string): Promise<FlowSheet> {
  const svc = await import("./service");
  const flow = await svc.getFlow(actor, flowId);
  const [all, hooks] = await Promise.all([
    svc.listFlows(actor),
    svc.listFlowWebhooks(actor, flowId, { redact: true }),
  ]);

  const effects: Record<string, "read" | "write" | undefined> = {};
  const { describeIntegrationActionEffect } = await import("@/lib/integrations/store");
  const { withWorkspaceTx } = await import("@/lib/tenant/context");
  for (const n of normalizeFlowNodes(flow.nodes)) {
    if (n.type !== "integration") continue;
    const raw = typeof n.config.integrationId === "string" ? n.config.integrationId : "";
    const [integrationId, action] = raw.split("::");
    if (!integrationId || !action) continue;
    const input =
      typeof n.config.input === "object" &&
      n.config.input !== null &&
      !Array.isArray(n.config.input)
        ? (n.config.input as Record<string, unknown>)
        : {};
    try {
      // Workspace transaction: FORCE RLS hides the integration row otherwise.
      effects[n.id] = await withWorkspaceTx(actor.workspaceId, (tx) =>
        describeIntegrationActionEffect(actor.workspaceId, integrationId, action, input, tx)
      );
    } catch {
      effects[n.id] = undefined;
    }
  }

  return describeFlow(flow, {
    otherFlows: all.map((f) => ({ id: f.id, name: f.name, nodes: f.nodes })),
    webhooks: hooks.map((w) => ({ id: w.id, enabled: w.enabled })),
    effects,
  });
}
