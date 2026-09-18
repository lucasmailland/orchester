import "server-only";
import { z } from "zod";
import type { ValidationIssue } from "@/lib/flows/validate";
import type { FlowInput } from "@/lib/flows/service";
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

/** Only flow validation failures opt into structured MCP error data. */
export class FlowToolValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[]
  ) {
    super(message);
    this.name = "FlowToolValidationError";
  }
}

/** Service errors reach the MCP client as a readable message with the issues. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { FlowServiceError } = await svc();
    if (e instanceof FlowServiceError && e.issues?.length) {
      throw new FlowToolValidationError(
        `${e.message}: ${e.issues.map((i) => `${i.nodeId ? `[${i.nodeId}] ` : ""}${i.message}`).join("; ")}`,
        e.issues
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

const updateInputSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  spec: z.string().nullable().optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "paused"]).optional(),
  enabled: z.boolean().optional(),
});

const createInputSchema = updateInputSchema.omit({ status: true, enabled: true }).extend({
  name: z.string().trim().min(1, "name required"),
});

/** Validate writable fields and strip unknown fields before calling the service. */
function pickInput(input: Record<string, unknown>, create = false): FlowInput {
  const parsed = (create ? createInputSchema : updateInputSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export const FLOW_TOOLS: McpToolDef[] = [
  {
    name: "get_flow",
    title: "Get a flow",
    description:
      "Devuelve un flujo completo: spec, pasos (con su propósito), conexiones, variables y estado.",
    access: "read",
    domain: "flows",
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
    domain: "flows",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, ...graphProps } },
    async handler(input, auth) {
      if (typeof input.flowId === "string" && input.flowId) {
        return { issues: await (await svc()).validateFlowById(actorOf(auth), input.flowId) };
      }
      const graph = updateInputSchema.pick({ nodes: true, edges: true, spec: true }).parse(input);
      const { validateStoredFlow } = await import("@/lib/flows/validate-stored");
      return {
        issues: validateStoredFlow(graph.nodes ?? [], graph.edges ?? [], {
          spec: graph.spec ?? null,
        }),
      };
    },
  },
  {
    name: "create_flow",
    title: "Create a flow",
    description:
      "Crea un flujo. Rechaza grafos con errores y devuelve los problemas; los avisos vuelven junto al flujo. status y enabled se ignoran al crear; usá update_flow para cambiarlos.",
    access: "write",
    domain: "flows",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, ...graphProps },
      required: ["name"],
    },
    async handler(input, auth) {
      const name = str(input.name, "name");
      return guard(async () =>
        (await svc()).createFlow(
          actorOf(auth),
          { ...pickInput(input, true), name },
          { strict: true }
        )
      );
    },
  },
  {
    name: "update_flow",
    title: "Update a flow",
    description: "Actualiza campos de un flujo (parcial). Rechaza grafos con errores.",
    access: "write",
    domain: "flows",
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
    domain: "flows",
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
    domain: "flows",
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
    domain: "flows",
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
    domain: "flows",
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
