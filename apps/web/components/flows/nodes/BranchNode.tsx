"use client";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { GitBranch, LifeBuoy, Repeat, Split, type LucideIcon } from "lucide-react";

interface BranchDef {
  id: string;
  label: string;
  color: string;
  /** posición vertical 0..1 del handle */
  top: number;
}

interface NodeData {
  label?: string;
  subtitle?: string;
  badge?: string | null;
}

/**
 * Nodo con varias salidas etiquetadas (caminos). Muestra el nombre de cada
 * salida en el lienzo para que cualquiera entienda a dónde va cada camino.
 */
function BranchNode({
  data,
  Icon,
  accent,
  branches,
}: {
  data: NodeData;
  Icon: LucideIcon;
  accent: string;
  branches: BranchDef[];
}) {
  const height = Math.max(56, branches.length * 26 + 24);
  return (
    <div
      className="relative min-w-[210px] rounded-xl border border-line bg-surface/95 px-3 py-3 shadow-md"
      style={{ borderLeftWidth: 3, borderLeftColor: accent, minHeight: height }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `${accent}1A`, color: accent }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-strong">{data.label}</div>
          {data.subtitle && <div className="truncate text-[10px] text-muted">{data.subtitle}</div>}
        </div>
      </div>
      {data.badge && (
        <div
          className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white shadow"
          title={data.badge}
        >
          !
        </div>
      )}
      {branches.map((b) => (
        <div key={b.id}>
          <span
            className="absolute right-3 text-[9px] font-medium"
            style={{ top: `calc(${b.top * 100}% - 6px)`, color: b.color }}
          >
            {b.label}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={b.id}
            style={{ top: `${b.top * 100}%`, background: b.color }}
          />
        </div>
      ))}
    </div>
  );
}

export function ConditionNode(p: NodeProps) {
  return (
    <BranchNode
      data={p.data as NodeData}
      Icon={GitBranch}
      accent="#f59e0b"
      branches={[
        { id: "true", label: "Sí", color: "#10b981", top: 0.34 },
        { id: "false", label: "No", color: "#ef4444", top: 0.7 },
      ]}
    />
  );
}

export function TryCatchNode(p: NodeProps) {
  return (
    <BranchNode
      data={p.data as NodeData}
      Icon={LifeBuoy}
      accent="#f97316"
      branches={[
        { id: "try", label: "Intentar", color: "#3b82f6", top: 0.34 },
        { id: "catch", label: "Si falla", color: "#f59e0b", top: 0.7 },
      ]}
    />
  );
}

export function LoopNode(p: NodeProps) {
  return (
    <BranchNode
      data={p.data as NodeData}
      Icon={Repeat}
      accent="#f59e0b"
      branches={[
        { id: "body", label: "Por cada uno", color: "#8b5cf6", top: 0.34 },
        { id: "done", label: "Al terminar", color: "#10b981", top: 0.7 },
      ]}
    />
  );
}

export function SwitchNode(p: NodeProps) {
  return (
    <BranchNode
      data={p.data as NodeData}
      Icon={Split}
      accent="#f59e0b"
      branches={[{ id: "default", label: "Siguiente", color: "#f59e0b", top: 0.5 }]}
    />
  );
}
