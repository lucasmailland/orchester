import "server-only";
import { describeFlow, type FlowSheet } from "./describe";
import { normalizeFlowNodes } from "./normalize";
import type { FlowActor } from "./service";

const TEMPLATE = /\{\{/;

/**
 * Loads a flow, its callers and its webhooks through the workspace-bound
 * service and returns its fact sheet. Used by the MCP tool and the REST route
 * so both answer the same thing.
 *
 * Effects are looked up per integration step and are never guessed: an action
 * that cannot be resolved (integration gone, disabled, ambiguous) stays
 * unknown, and a "read" is only trusted when the step's input has no template,
 * because some actions decide their effect from the input.
 */
export async function loadFlowSheet(actor: FlowActor, flowId: string): Promise<FlowSheet> {
  const svc = await import("./service");
  const flow = await svc.getFlow(actor, flowId);
  const [all, hooks] = await Promise.all([
    svc.listFlows(actor),
    svc.listFlowWebhooks(actor, flowId, { redact: true }),
  ]);

  const effects: Record<string, "read" | "write" | undefined> = {};
  const { getIntegrationActionEffect } = await import("@/lib/integrations/store");
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
      const effect = await getIntegrationActionEffect(
        actor.workspaceId,
        integrationId,
        action,
        input
      );
      effects[n.id] =
        effect === "write" || !TEMPLATE.test(JSON.stringify(input)) ? effect : undefined;
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
