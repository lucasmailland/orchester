import { getNodeDef, NODE_REGISTRY, type Locale } from "./node-registry";
import { getNodeDocs } from "./node-docs";
import type { ToolDefinitionForLlm } from "../llm-call";

/**
 * Herramientas del copiloto del Flow Builder. El modelo arma el flujo llamando
 * a `set_flow` con la lista de pasos y conexiones; acá lo validamos contra el
 * registry y lo posicionamos automáticamente. Mantener PURO y testeable.
 */

export interface SpecNode {
  /** id elegido por el modelo (legible: "inicio", "agente1"…). */
  id: string;
  /** id de nodo del registry (ej. "agent", "http", "trigger_message"). */
  nodeId: string;
  label?: string;
  config?: Record<string, unknown>;
}
export interface SpecEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}
export interface FlowSpec {
  nodes: SpecNode[];
  edges: SpecEdge[];
}

export interface BuiltNode {
  id: string;
  type: string; // engine type
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown>; nodeId: string };
}
export interface BuiltEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}
export interface BuildResult {
  nodes: BuiltNode[];
  edges: BuiltEdge[];
  errors: string[];
}

/**
 * Convierte una spec del modelo en nodos/edges válidos del builder. Valida cada
 * `nodeId` contra el registry, fusiona defaults + fixedConfig, y auto-posiciona
 * en columnas (layout simple de izquierda a derecha por orden topológico burdo).
 */
export function buildGraphFromSpec(spec: FlowSpec, idFor: () => string): BuildResult {
  const errors: string[] = [];
  const nodes: BuiltNode[] = [];
  const idMap: Record<string, string> = {}; // spec id -> real id

  // Orden por "profundidad" desde los triggers para un layout legible.
  const depth = computeDepth(spec);

  let i = 0;
  for (const sn of spec.nodes) {
    const def = getNodeDef(sn.nodeId);
    if (!def) {
      errors.push(`Paso desconocido: "${sn.nodeId}".`);
      continue;
    }
    const realId = idFor();
    idMap[sn.id] = realId;
    const d = depth[sn.id] ?? i;
    nodes.push({
      id: realId,
      type: def.engine,
      position: { x: 80 + d * 240, y: 80 + columnOffset(spec, sn.id, depth) * 140 },
      data: {
        label: sn.label || def.title["es"],
        config: { ...(def.defaults ?? {}), ...(def.fixedConfig ?? {}), ...(sn.config ?? {}) },
        nodeId: def.id,
      },
    });
    i++;
  }

  const edges: BuiltEdge[] = [];
  for (const se of spec.edges) {
    const source = idMap[se.source];
    const target = idMap[se.target];
    if (!source || !target) {
      errors.push(`Conexión inválida: ${se.source} → ${se.target}.`);
      continue;
    }
    const edge: BuiltEdge = { id: idFor(), source, target };
    if (se.sourceHandle) edge.sourceHandle = se.sourceHandle;
    if (se.label) edge.label = se.label;
    edges.push(edge);
  }

  return { nodes, edges, errors };
}

/** Profundidad (columna) de cada nodo siguiendo las conexiones desde los inicios. */
function computeDepth(spec: FlowSpec): Record<string, number> {
  const adj: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  for (const n of spec.nodes) {
    adj[n.id] = [];
    indeg[n.id] = 0;
  }
  for (const e of spec.edges) {
    const list = adj[e.source];
    if (list) list.push(e.target);
    if (e.target in indeg) indeg[e.target] = (indeg[e.target] ?? 0) + 1;
  }
  const depth: Record<string, number> = {};
  const queue = spec.nodes.filter((n) => (indeg[n.id] ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth[id] = 0;
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    for (const next of adj[id] ?? []) {
      const cand = (depth[id] ?? 0) + 1;
      if (depth[next] === undefined || cand > depth[next]) depth[next] = cand;
      queue.push(next);
      if (queue.length > 10_000) break; // guarda anti-ciclos
    }
  }
  return depth;
}

/** Reparte verticalmente los nodos que comparten columna. */
function columnOffset(spec: FlowSpec, id: string, depth: Record<string, number>): number {
  const myDepth = depth[id] ?? 0;
  const sameCol = spec.nodes.filter((n) => (depth[n.id] ?? 0) === myDepth);
  return sameCol.findIndex((n) => n.id === id);
}

/** Tabla compacta de nodos disponibles para el system prompt del copiloto. */
export function nodeCatalogForPrompt(locale: Locale = "es"): string {
  return Object.values(NODE_REGISTRY)
    .map((d) => {
      const fields = d.fields.map((f) => f.key).join(", ");
      const docs = getNodeDocs(d.id);
      const when = docs ? ` Cuándo conviene: ${docs.whenToUse[locale]}` : "";
      return `- ${d.id}: ${d.title[locale]} — ${d.summary[locale]}${when}${fields ? ` (campos: ${fields})` : ""}`;
    })
    .join("\n");
}

/** Definición de la tool `set_flow` para el modelo. */
export const COPILOT_TOOLS: ToolDefinitionForLlm[] = [
  {
    name: "set_flow",
    description:
      "Define el flujo completo: la lista de pasos (nodes) y sus conexiones (edges). " +
      "Cada paso usa un 'nodeId' del catálogo. Conectá los pasos en el orden de ejecución. " +
      "Todo flujo empieza con un paso disparador (trigger_*).",
    inputSchema: {
      type: "object",
      properties: {
        nodes: {
          type: "array",
          description: "Pasos del flujo.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Identificador local del paso (ej. 'inicio', 'agente1').",
              },
              nodeId: {
                type: "string",
                description: "Tipo de paso del catálogo (ej. 'agent', 'http').",
              },
              label: { type: "string", description: "Nombre claro del paso para una persona." },
              config: {
                type: "object",
                description: "Configuración del paso (campos del catálogo).",
              },
            },
            required: ["id", "nodeId"],
          },
        },
        edges: {
          type: "array",
          description: "Conexiones entre pasos.",
          items: {
            type: "object",
            properties: {
              source: { type: "string", description: "id del paso de origen." },
              target: { type: "string", description: "id del paso de destino." },
              sourceHandle: {
                type: "string",
                description: "Para 'Si…entonces' usá 'true'/'false'; para caminos, el valor.",
              },
              label: { type: "string" },
            },
            required: ["source", "target"],
          },
        },
      },
      required: ["nodes", "edges"],
    },
  },
];

/** System prompt del copiloto en modo "construir". */
export function buildSystemPrompt(locale: Locale = "es"): string {
  return [
    "Sos el copiloto del Flow Builder de Orchester. Ayudás a personas (técnicas y no técnicas)",
    "a armar flujos automáticos. Hablás claro, sin jerga.",
    "",
    "Cuando el usuario describe lo que quiere (y opcionalmente una URL de API), armás el flujo",
    "llamando a la herramienta set_flow con los pasos y conexiones.",
    "Si te pasan un 'flujo actual', NO empieces de cero: modificá ese flujo y devolvé el flujo",
    "COMPLETO actualizado con set_flow, conservando el id de los pasos que se mantienen. Reglas:",
    "- Todo flujo arranca con un disparador (trigger_manual, trigger_message, trigger_schedule o trigger_webhook).",
    "- Usá nombres de paso claros en 'label' (lo lee una persona).",
    "- Conectá los pasos en orden. Para 'Si…entonces' (condition) usá sourceHandle 'true' y 'false'.",
    "- Si te dan una URL de API, usá un paso 'http' con esa URL.",
    "- Después de set_flow, explicá en 1-2 frases simples qué hace el flujo.",
    "",
    "Catálogo de pasos disponibles:",
    nodeCatalogForPrompt(locale),
  ].join("\n");
}
