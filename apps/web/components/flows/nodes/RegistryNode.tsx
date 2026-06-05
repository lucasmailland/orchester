"use client";
import type { NodeProps } from "@xyflow/react";
import { SimpleNode } from "./SimpleNode";
import { iconFor } from "./icon-map";
import { getNodeDef } from "@/lib/flows/node-registry";

/**
 * Nodo genérico del lienzo: toma su ícono y color del `node-registry` según
 * `data.nodeId`. Así cada paso muestra su propio ícono (antes todos usaban el
 * mismo por estar mapeados a un componente fijo).
 */
export function RegistryNode(p: NodeProps) {
  const d = p.data as {
    nodeId?: string;
    label?: string;
    subtitle?: string;
    badge?: string | null;
  };
  const def = getNodeDef(String(d.nodeId ?? p.type ?? ""));
  const Icon = iconFor(def?.icon);
  const accent = def?.accent ?? "#64748b";
  const isTrigger = (def?.engine ?? p.type) === "trigger";
  return (
    <SimpleNode
      data={{ label: d.label ?? def?.title.es ?? "Paso", subtitle: d.subtitle, badge: d.badge }}
      Icon={Icon}
      accent={accent}
      showTargetHandle={!isTrigger}
    />
  );
}
