import "server-only";
import type { McpAuth, McpToolDef } from "./server";

/**
 * The flow half of the MCP tool catalog: build, validate, run and debug a flow
 * with a workspace API key.
 *
 * Every tool goes through `@/lib/flows/service`, which binds each read and
 * write to the actor's workspace. Nothing here touches the database directly.
 * Only types are imported from `./server`, so registering these tools in its
 * `TOOLS` array does not create a runtime import cycle.
 */

export const actorOf = (auth: McpAuth) => ({
  kind: "apiKey" as const,
  workspaceId: auth.workspaceId,
  keyId: auth.keyId,
});

const svc = () => import("@/lib/flows/service");

/** Service errors reach the MCP client as a readable message with the issues. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { FlowServiceError } = await svc();
    if (e instanceof FlowServiceError && e.issues?.length) {
      throw new Error(
        `${e.message}: ${e.issues.map((i) => `${i.nodeId ? `[${i.nodeId}] ` : ""}${i.message}`).join("; ")}`
      );
    }
    throw e;
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`${name} is required`);
  return v;
};

const graphProps = {
  nodes: {
    type: "array",
    items: { type: "object" },
    description: "Stored nodes: { id, type, label, config, position, purpose }.",
  },
  edges: {
    type: "array",
    items: { type: "object" },
    description:
      "{ id, source, target, sourceHandle? }. try_catch uses try/catch/done; parallel uses done.",
  },
  variables: { type: "object" },
  spec: {
    type: ["string", "null"],
    description: "Markdown: Purpose, Trigger, Steps, Side effects, Failure handling, Dependencies.",
  },
  description: { type: ["string", "null"] },
};

/** Only the fields a caller may set reach the service; anything else is ignored. */
function pickInput(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of [
    "name",
    "description",
    "spec",
    "nodes",
    "edges",
    "variables",
    "status",
    "enabled",
  ]) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  return out;
}

export const FLOW_TOOLS: McpToolDef[] = [
  {
    name: "get_flow",
    title: "Get a flow",
    description:
      "Devuelve un flujo completo: spec, pasos (con su propósito), conexiones, variables y estado.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string" } },
      required: ["flowId"],
    },
    async handler(input, auth) {
      const f = await (await svc()).getFlow(actorOf(auth), str(input.flowId, "flowId"));
      const {
        id,
        name,
        description,
        spec,
        status,
        enabled,
        trigger,
        nodes,
        edges,
        variables,
        version,
      } = f;
      return {
        id,
        name,
        description,
        spec,
        status,
        enabled,
        trigger,
        nodes,
        edges,
        variables,
        version,
      };
    },
  },
  {
    name: "validate_flow",
    title: "Validate a flow",
    description:
      "Valida un flujo guardado (flowId) o un grafo sin guardar ({ nodes, edges, spec }). Devuelve errores y avisos.",
    access: "read",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, ...graphProps } },
    async handler(input, auth) {
      if (typeof input.flowId === "string" && input.flowId) {
        return { issues: await (await svc()).validateFlowById(actorOf(auth), input.flowId) };
      }
      const { validateStoredFlow } = await import("@/lib/flows/validate-stored");
      return {
        issues: validateStoredFlow(input.nodes ?? [], input.edges ?? [], {
          spec: typeof input.spec === "string" ? input.spec : null,
        }),
      };
    },
  },
  {
    name: "create_flow",
    title: "Create a flow",
    description:
      "Crea un flujo. Rechaza grafos con errores y devuelve los problemas; los avisos vuelven junto al flujo.",
    access: "write",
    scope: "flows",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, ...graphProps },
      required: ["name"],
    },
    async handler(input, auth) {
      const name = str(input.name, "name");
      return guard(async () =>
        (await svc()).createFlow(actorOf(auth), { ...pickInput(input), name }, { strict: true })
      );
    },
  },
  {
    name: "update_flow",
    title: "Update a flow",
    description: "Actualiza campos de un flujo (parcial). Rechaza grafos con errores.",
    access: "write",
    scope: "flows",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused"] },
        enabled: { type: "boolean" },
        ...graphProps,
      },
      required: ["flowId"],
    },
    async handler(input, auth) {
      const flowId = str(input.flowId, "flowId");
      return guard(async () =>
        (await svc()).updateFlow(actorOf(auth), flowId, pickInput(input), { strict: true })
      );
    },
  },
  {
    name: "get_flow_run",
    title: "Get a flow run",
    description:
      "Estado, entrada, salida y error de una corrida, con sus pasos en orden. Los pasos guardan entradas y salidas tal cual: pueden contener datos sensibles del flujo.",
    access: "read",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
    async handler(input, auth) {
      return (await svc()).getFlowRun(actorOf(auth), str(input.runId, "runId"));
    },
  },
  {
    name: "list_flow_runs",
    title: "List flow runs",
    description: "Últimas corridas de un flujo, sin pasos. Default 20, máximo 100.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string" }, limit: { type: "number" } },
      required: ["flowId"],
    },
    async handler(input, auth) {
      const runs = await (
        await svc()
      ).listFlowRuns(actorOf(auth), str(input.flowId, "flowId"), Number(input.limit ?? 20));
      return { runs };
    },
  },
  {
    name: "create_flow_webhook",
    title: "Create a flow webhook",
    description:
      "Crea un webhook para el flujo y devuelve su URL. Es la única vez que se devuelve el secreto: guardalo donde corresponda.",
    access: "write",
    scope: "flows",
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string" }, hmac: { type: "boolean" } },
      required: ["flowId"],
    },
    async handler(input, auth) {
      const s = await svc();
      const w = await s.createFlowWebhook(actorOf(auth), str(input.flowId, "flowId"), {
        hmac: input.hmac === true,
      });
      return {
        id: w.id,
        url: s.webhookUrl(w.secret),
        ...(w.hmacKey ? { hmacKey: w.hmacKey } : {}),
      };
    },
  },
  {
    name: "list_flow_webhooks",
    title: "List flow webhooks",
    description: "Webhooks de un flujo: id, fecha y si usa HMAC. Nunca devuelve secretos.",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { flowId: { type: "string" } },
      required: ["flowId"],
    },
    async handler(input, auth) {
      return {
        webhooks: await (
          await svc()
        ).listFlowWebhooks(actorOf(auth), str(input.flowId, "flowId"), {
          redact: true,
        }),
      };
    },
  },
];
