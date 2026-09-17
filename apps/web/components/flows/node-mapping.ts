import type { Node } from "@xyflow/react";

/**
 * Traducción del nodo guardado en la base al nodo del lienzo.
 *
 * Vive fuera de `FlowBuilder.tsx` a propósito: es puro y no depende del runtime
 * de xyflow, del router ni de next-intl, así que se puede probar solo. El
 * camino de vuelta (lienzo → guardado) lo arma `buildFlowPayload`, en
 * `@/lib/flows/payload`, que es lo que se compara para decidir si hay cambios.
 */

export interface StoredNodeDTO {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  purpose?: string;
}

/** Deriva el id del registry a partir del nodo guardado (que sólo tiene engine type). */
export function deriveNodeId(n: { type: string; config?: Record<string, unknown> }): string {
  if (n.type === "trigger") {
    const kind = (n.config?.triggerKind as string) ?? "manual";
    return `trigger_${kind}`;
  }
  return n.type;
}

export function subtitleFor(n: {
  type: string;
  config?: Record<string, unknown> | undefined;
}): string {
  if (n.type === "agent" && n.config?.agentId)
    return `agentId: ${(n.config.agentId as string).slice(0, 8)}`;
  if (n.type === "http" && n.config?.url) return String(n.config.url).slice(0, 32);
  return "";
}

export function toCanvasNode(n: StoredNodeDTO): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.label,
      subtitle: subtitleFor(n),
      config: n.config,
      nodeId: deriveNodeId(n),
      ...(n.purpose ? { purpose: n.purpose } : {}),
    },
  };
}
