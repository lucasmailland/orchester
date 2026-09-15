import { NODE_REGISTRY, getNodeDef } from "./node-registry";
import type { FlowSpec } from "./copilot-tools";

/**
 * One shape for flow graphs, whatever produced them.
 *
 * The editor stores nodes as { id, type, label, config, position }. The Compass
 * flow templates sent { id, type, position, data: { label } } with node types
 * the editor never had (tool, branch, handoff), and POST /api/flows stored them
 * verbatim. Every flow created from those templates crashed the editor on
 * `node.config.agentId`, and kept crashing each time it was opened.
 *
 * Client-safe on purpose: the editor runs it when opening a flow, so it may
 * only depend on the node registry.
 */

export interface StoredFlowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface StoredFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

const ENGINE_TYPES = new Set<string>([
  ...Object.values(NODE_REGISTRY).map((def) => def.engine),
  "end",
]);

/** Legacy types with a real equivalent. `tool` has none: it meant anything. */
const LEGACY_TYPES: Record<string, string> = { branch: "condition", handoff: "wait_human" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === "number" && typeof value.y === "number";
}

/** The registry step a stored node is — triggers share one engine type. */
function registryIdOf(type: string, config: Record<string, unknown>): string {
  return type === "trigger" ? `trigger_${String(config.triggerKind ?? "manual")}` : type;
}

export function normalizeFlowNodes(raw: unknown): StoredFlowNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: StoredFlowNode[] = [];

  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    const data = isRecord(item.data) ? item.data : {};
    const rawType = typeof item.type === "string" ? item.type : "";
    const label = [item.label, data.label].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== ""
    );
    const id = typeof item.id === "string" && item.id !== "" ? item.id : `node-${index + 1}`;
    const position = isPosition(item.position) ? item.position : { x: 80 + index * 240, y: 80 };
    const storedConfig = isRecord(item.config)
      ? item.config
      : isRecord(data.config)
        ? data.config
        : null;
    const type = LEGACY_TYPES[rawType] ?? rawType;

    if (!ENGINE_TYPES.has(type)) {
      // No equivalent: keep the step visible and say what it was, rather than
      // inventing a behaviour the template never defined.
      nodes.push({
        id,
        type: "note",
        label: label ?? "Paso sin equivalente",
        config: {
          text: `Este paso («${label ?? "sin nombre"}», tipo "${rawType || "desconocido"}") venía de un formato viejo y no existe en el editor. Reemplazalo por un paso real.`,
        },
        position,
      });
      return;
    }

    // A node without a config came from the legacy shape: give it what a newly
    // added step of that kind starts with. A stored config is left untouched.
    let config = storedConfig;
    if (!config) {
      const def = getNodeDef(registryIdOf(type, {}));
      config = { ...(def?.defaults ?? {}), ...(def?.fixedConfig ?? {}) };
    }
    const def = getNodeDef(registryIdOf(type, config));
    nodes.push({ id, type, label: label ?? def?.title.es ?? type, config, position });
  });

  return nodes;
}

export function normalizeFlowEdges(raw: unknown): StoredFlowEdge[] {
  if (!Array.isArray(raw)) return [];
  const edges: StoredFlowEdge[] = [];

  raw.forEach((item, index) => {
    if (!isRecord(item) || typeof item.source !== "string" || typeof item.target !== "string")
      return;
    const edge: StoredFlowEdge = {
      id:
        typeof item.id === "string" && item.id !== ""
          ? item.id
          : `e-${item.source}-${item.target}-${index}`,
      source: item.source,
      target: item.target,
    };
    if (typeof item.sourceHandle === "string" && item.sourceHandle !== "")
      edge.sourceHandle = item.sourceHandle;
    if (typeof item.label === "string") edge.label = item.label;
    edges.push(edge);
  });

  return edges;
}

/**
 * A FlowSpec as stored nodes and edges, for templates defined outside the
 * editor.
 *
 * Mirrors buildGraphFromSpec — same engine type, label and config merge — but
 * keeps the spec's ids and does not import copilot-tools, which drags the node
 * docs into every page that shows the template picker. A test holds the two
 * in step.
 */
export function specToStoredGraph(spec: FlowSpec): {
  nodes: StoredFlowNode[];
  edges: StoredFlowEdge[];
} {
  const known = new Set<string>();
  const nodes = spec.nodes.map((specNode, index) => {
    const def = getNodeDef(specNode.nodeId);
    if (!def) throw new Error(`Paso desconocido en la plantilla: "${specNode.nodeId}".`);
    known.add(specNode.id);
    return {
      id: specNode.id,
      type: def.engine,
      label: specNode.label || def.title.es,
      config: { ...(def.defaults ?? {}), ...(def.fixedConfig ?? {}), ...(specNode.config ?? {}) },
      position: { x: 80 + index * 240, y: 160 },
    };
  });

  const edges = spec.edges.map((specEdge, index) => {
    if (!known.has(specEdge.source) || !known.has(specEdge.target)) {
      throw new Error(
        `Conexión inválida en la plantilla: ${specEdge.source} → ${specEdge.target}.`
      );
    }
    const edge: StoredFlowEdge = {
      id: `e${index + 1}`,
      source: specEdge.source,
      target: specEdge.target,
    };
    if (specEdge.sourceHandle) edge.sourceHandle = specEdge.sourceHandle;
    if (specEdge.label) edge.label = specEdge.label;
    return edge;
  });

  return { nodes, edges };
}
