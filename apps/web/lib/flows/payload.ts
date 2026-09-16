/**
 * The flow graph in the shape `PATCH /api/flows/:id` stores, plus a signature
 * to tell a real edit apart from the editor's own bookkeeping.
 *
 * React Flow writes measurements, selection and drag state onto the node
 * objects right after mounting. Those updates reach the builder's auto-save
 * debounce like any other state change, so opening a flow used to rewrite it
 * with a PATCH nobody asked for. Comparing signatures instead of object
 * identity keeps auto-save for changes that actually alter what is stored.
 */

/** A React Flow node, narrowed to the fields that end up stored. */
export interface BuilderNode {
  id: string;
  type?: string | undefined;
  position: { x: number; y: number };
  data?: unknown;
}

/** A React Flow edge, narrowed the same way. */
export interface BuilderEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null | undefined;
  label?: unknown;
}

export interface FlowPayloadNode {
  id: string;
  type: string | undefined;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowPayload {
  nodes: FlowPayloadNode[];
  edges: Record<string, unknown>[];
  variables: Record<string, unknown>;
}

export function buildFlowPayload(
  nodes: readonly BuilderNode[],
  edges: readonly BuilderEdge[],
  variables: Record<string, unknown>
): FlowPayload {
  return {
    nodes: nodes.map((n) => {
      const data = (n.data ?? {}) as { label?: string; config?: Record<string, unknown> };
      return {
        id: n.id,
        type: n.type,
        label: data.label ?? "",
        config: data.config ?? {},
        position: n.position,
      };
    }),
    edges: edges.map((e) => {
      const out: Record<string, unknown> = { id: e.id, source: e.source, target: e.target };
      if (e.sourceHandle) out.sourceHandle = e.sourceHandle;
      if (typeof e.label === "string") out.label = e.label;
      return out;
    }),
    variables,
  };
}

/**
 * Two payloads with the same signature store the same flow. Key order is fixed
 * by how `buildFlowPayload` builds the objects, so plain JSON is enough.
 */
export function flowSignature(payload: FlowPayload): string {
  return JSON.stringify(payload);
}
